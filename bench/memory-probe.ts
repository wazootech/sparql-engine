// Peak-memory measurement for the README's memory comparison. Each engine
// runs in its own process (the probe is spawned per engine, so only the
// target engine is loaded), executes the workload several times, and reports
// the peak heap/RSS observed.
//
//   deno run --allow-all bench/memory-probe.ts <wazoo|comunica|oxigraph> <scan|exists>
//
// Prints one JSON document to stdout.
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";

const { blankNode, literal, namedNode, quad } = DataFactory;

const PERSON_COUNT = 10_000;
const foafName = namedNode("http://xmlns.com/foaf/0.1/name");
const foafAge = namedNode("http://xmlns.com/foaf/0.1/age");
const examplePet = namedNode("http://example.org/pet");
const exCity = namedNode("http://example.org/city");
const exSpouse = namedNode("http://example.org/spouse");
const examplePerson = (index: number) =>
  namedNode(`http://example.org/person${index}`);

function buildPeopleDataset(count: number): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < count; index++) {
    const person = examplePerson(index);
    quads.push(quad(person, foafName, literal(`Person ${index}`)));
    quads.push(quad(person, foafAge, literal(`${20 + (index % 50)}`)));
    quads.push(quad(person, examplePet, blankNode(`pet-${index}`)));
    quads.push(
      quad(
        person,
        namedNode("http://xmlns.com/foaf/0.1/knows"),
        examplePerson((index + 1) % count),
      ),
    );
    quads.push(quad(person, exCity, literal(`City ${index % 5}`)));
    if (index % 2 === 0) {
      quads.push(quad(person, exSpouse, examplePerson(index + 1)));
    }
  }
  return quads;
}

const SCAN_QUERY = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const NESTED_EXISTS_QUERY =
  "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
  "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse . " +
  "FILTER EXISTS { ?spouse <http://xmlns.com/foaf/0.1/name> ?n2 } } }";

const engine = Deno.args[0];
const workload = Deno.args[1];
if (engine !== "wazoo" && engine !== "comunica" && engine !== "oxigraph") {
  throw new Error(`unknown engine: ${engine}`);
}
if (workload !== "scan" && workload !== "exists") {
  throw new Error(`unknown workload: ${workload}`);
}
const query = workload === "scan" ? SCAN_QUERY : NESTED_EXISTS_QUERY;
const RUNS = 5;

const dataset = buildPeopleDataset(PERSON_COUNT);
const baseline = Deno.memoryUsage();

let peakHeap = baseline.heapUsed;
let peakRss = baseline.rss;
let peakExternal = baseline.external;
const observe = (): void => {
  const m = Deno.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed);
  peakRss = Math.max(peakRss, m.rss);
  peakExternal = Math.max(peakExternal, m.external);
};

async function runWorkload(): Promise<void> {
  if (engine === "wazoo") {
    const store = new Store();
    for (const q of dataset) {
      store.addQuad(q);
    }
    const { WazooSparqlEngine } = await import("@/wazoo-sparql-engine.ts");
    const wazooEngine = new WazooSparqlEngine({ store });
    for (let i = 0; i < RUNS; i++) {
      const result = await wazooEngine.execute({ query });
      if (result.kind !== "select") {
        throw new Error(`wazoo returned ${result.kind}`);
      }
      observe();
    }
    return;
  }
  if (engine === "comunica") {
    const store = new Store();
    for (const q of dataset) {
      store.addQuad(q);
    }
    const { QueryEngine } = await import(
      "@comunica/query-sparql-rdfjs-lite"
    );
    const comunicaEngine = new QueryEngine();
    for (let i = 0; i < RUNS; i++) {
      const stream = await comunicaEngine.queryBindings(query, {
        sources: [store],
      });
      const bindings = await stream.toArray();
      if (bindings.length === 0) {
        throw new Error(`comunica returned no bindings`);
      }
      observe();
    }
    return;
  }
  // oxigraph
  const ox = await import("oxigraph");
  const toOxigraphTerm = (term: rdfjs.Term): unknown => {
    switch (term.termType) {
      case "NamedNode":
        return ox.namedNode(term.value);
      case "BlankNode":
        return ox.blankNode(term.value);
      case "Literal": {
        const literalTerm = term as rdfjs.Literal;
        if (literalTerm.language) {
          return ox.literal(literalTerm.value, literalTerm.language);
        }
        if (literalTerm.datatype) {
          return ox.literal(
            literalTerm.value,
            ox.namedNode(literalTerm.datatype.value),
          );
        }
        return ox.literal(literalTerm.value);
      }
      case "DefaultGraph":
        return ox.defaultGraph();
      default:
        throw new Error(`unsupported term type: ${term.termType}`);
    }
  };
  const toOxigraphQuad = (item: rdfjs.Quad): unknown =>
    ox.quad(
      toOxigraphTerm(item.subject) as never,
      toOxigraphTerm(item.predicate) as never,
      toOxigraphTerm(item.object) as never,
      toOxigraphTerm(item.graph) as never,
    );
  const store = new ox.Store();
  for (const q of dataset) {
    store.add(toOxigraphQuad(q) as never);
  }
  for (let i = 0; i < RUNS; i++) {
    const result = store.query(query) as unknown[];
    if (result.length === 0) {
      throw new Error(`oxigraph returned no bindings`);
    }
    observe();
  }
}

await runWorkload();
console.log(
  JSON.stringify({
    engine,
    workload,
    runs: RUNS,
    baseline: {
      heapUsed: baseline.heapUsed,
      rss: baseline.rss,
    },
    peak: {
      heapUsed: peakHeap,
      rss: peakRss,
      external: peakExternal,
    },
  }),
);

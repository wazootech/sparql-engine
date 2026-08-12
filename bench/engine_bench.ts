import type * as rdfjs from "@rdfjs/types";
import { assertEquals } from "@std/assert";
import { DataFactory, Store } from "n3";
import {
  blankNode as oxigraphBlankNode,
  defaultGraph as oxigraphDefaultGraph,
  literal as oxigraphLiteral,
  namedNode as oxigraphNamedNode,
  quad as oxigraphQuad,
  Store as OxigraphStore,
} from "oxigraph";
import { NativeSparqlEngine } from "@/native-sparql-engine.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "../test/parity/parity-harness.ts";
import { canonicalizeRdfTerm, canonicalizeSparqlValue } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";

const { blankNode, literal, namedNode, quad } = DataFactory;

const PERSON_COUNT = 400;
const foafName = namedNode("http://xmlns.com/foaf/0.1/name");
const foafKnows = namedNode("http://xmlns.com/foaf/0.1/knows");
const foafAge = namedNode("http://xmlns.com/foaf/0.1/age");
const examplePet = namedNode("http://example.org/pet");
const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
const examplePerson = (index: number) =>
  namedNode(`http://example.org/person${index}`);

/**
 * buildDataset generates the shared benchmark graph: a ring of people, each
 * with a name, an integer age, a blank node pet, and a knows edge.
 */
function buildDataset(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < PERSON_COUNT; index++) {
    const person = examplePerson(index);
    quads.push(quad(person, foafName, literal(`Person ${index}`)));
    quads.push(
      quad(
        person,
        foafAge,
        literal(`${20 + (index % 50)}`, xsdInteger),
      ),
    );
    quads.push(quad(person, examplePet, blankNode(`pet-${index}`)));
    quads.push(
      quad(
        person,
        foafKnows,
        examplePerson((index + 1) % PERSON_COUNT),
      ),
    );
  }
  return quads;
}

/**
 * toOxigraphTerm maps an RDF/JS term to its Oxigraph equivalent.
 */
function toOxigraphTerm(term: rdfjs.Term): unknown {
  switch (term.termType) {
    case "NamedNode":
      return oxigraphNamedNode(term.value);
    case "BlankNode":
      return oxigraphBlankNode(term.value);
    case "Literal":
      if (term.language) {
        return oxigraphLiteral(term.value, term.language);
      }
      if (term.datatype) {
        return oxigraphLiteral(
          term.value,
          oxigraphNamedNode(term.datatype.value),
        );
      }
      return oxigraphLiteral(term.value);
    case "DefaultGraph":
      return oxigraphDefaultGraph();
    default:
      throw new Error(`Unsupported RDF term type: ${term.termType}`);
  }
}

/**
 * toOxigraphQuad maps an RDF/JS quad to its Oxigraph equivalent.
 */
function toOxigraphQuad(item: rdfjs.Quad): ReturnType<typeof oxigraphQuad> {
  return oxigraphQuad(
    toOxigraphTerm(item.subject) as Parameters<typeof oxigraphQuad>[0],
    toOxigraphTerm(item.predicate) as Parameters<typeof oxigraphQuad>[1],
    toOxigraphTerm(item.object) as Parameters<typeof oxigraphQuad>[2],
    toOxigraphTerm(item.graph) as Parameters<typeof oxigraphQuad>[3],
  );
}

const dataset = buildDataset();
const n3Store = new Store();
const oxigraphStore = new OxigraphStore();
for (const item of dataset) {
  n3Store.addQuad(item);
  oxigraphStore.add(toOxigraphQuad(item));
}

const nativeEngine = new NativeSparqlEngine({ store: n3Store });
const nativeEngineNoReorder = new NativeSparqlEngine({
  store: n3Store,
  reorderPatterns: false,
});
const comunicaEngine = getComunicaEngine();

const scanQuery = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const joinQuery =
  "SELECT ?friend ?name WHERE { ?person <http://xmlns.com/foaf/0.1/knows> ?friend . " +
  "?friend <http://xmlns.com/foaf/0.1/name> ?name }";
// Written order is worst-case for the native engine: the unselective pattern
// (0 constants, matches all 1,600 quads) comes first, followed by a very
// selective pattern (2 constants, 1 quad). Static reordering flips them.
const asymJoinQuery = "SELECT ?s ?p ?o ?n WHERE { ?s ?p ?o . " +
  "<http://example.org/person0> <http://xmlns.com/foaf/0.1/name> ?n }";
const askQuery =
  "ASK WHERE { <http://example.org/person0> <http://xmlns.com/foaf/0.1/name> ?name }";
// Join chain written in worst-case order for a static planner: all three
// patterns have one constant, so a constant-count heuristic keeps the
// written order and joins ?grand <name> ?n before ?friend binds ?grand,
// forcing a 400x400 intermediate. Dynamic reordering sees that the name
// pattern's variable stays unbound and instead joins the knows patterns
// first, collapsing the intermediate to 400.
const chainQuery =
  "SELECT ?s ?grand ?n WHERE { ?s <http://xmlns.com/foaf/0.1/knows> ?friend . " +
  "?grand <http://xmlns.com/foaf/0.1/name> ?n . " +
  "?friend <http://xmlns.com/foaf/0.1/knows> ?grand }";
const constructQuery =
  "CONSTRUCT { ?person <http://example.org/displayName> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";

/**
 * OxigraphBinding is the structural binding shape Oxigraph returns.
 */
type OxigraphBinding = {
  get(name: string): unknown;
  keys(): IterableIterator<unknown>;
};

/**
 * bindingRecord renders a binding as a deterministic, sorted string.
 */
function bindingRecord(record: Record<string, CanonicalTerm>): string {
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((name) => [name, record[name]]),
  );
}

/**
 * quadRecord renders a quad as a deterministic string.
 */
function quadRecord(
  item: rdfjs.Quad,
  canonicalize: (term: rdfjs.Term) => CanonicalTerm,
): string {
  return [item.subject, item.predicate, item.object, item.graph]
    .map((term) => JSON.stringify(canonicalize(term)))
    .join(" ");
}

/**
 * oxigraphBindingRecord renders an Oxigraph binding as a canonical string.
 */
function oxigraphBindingRecord(binding: OxigraphBinding): string {
  const record: Record<string, CanonicalTerm> = {};
  for (const key of binding.keys()) {
    const name = typeof key === "string"
      ? key
      : (key as { value: string }).value;
    const term = binding.get(name);
    if (term !== undefined && term !== null) {
      record[name] = canonicalizeRdfTerm(term as unknown as rdfjs.Term);
    }
  }
  return bindingRecord(record);
}

/**
 * verifySelectEquality asserts all three engines return identical SELECT
 * results for the given query, so benchmark timings compare like for like.
 */
async function verifySelectEquality(
  query: string,
  label: string,
): Promise<void> {
  const nativeResult = await nativeEngine.execute({ query });
  if (nativeResult.kind !== "select") {
    throw new Error(`${label}: native engine returned ${nativeResult.kind}`);
  }
  const nativeSet = nativeResult.data.results.bindings
    .map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return bindingRecord(record);
    })
    .sort();

  const comunicaBindings = await runComunicaRawSelectBindings(
    comunicaEngine,
    query,
    n3Store,
  );
  const comunicaSet = comunicaBindings
    .map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeComunicaTerm(binding[name]);
      }
      return bindingRecord(record);
    })
    .sort();

  const oxigraphBindings = oxigraphStore.query(
    query,
  ) as unknown as OxigraphBinding[];
  const oxigraphSet = oxigraphBindings.map(oxigraphBindingRecord).sort();

  assertEquals(
    nativeSet,
    comunicaSet,
    `${label}: native and comunica disagree`,
  );
  assertEquals(
    nativeSet,
    oxigraphSet,
    `${label}: native and oxigraph disagree`,
  );
}

/**
 * verifyAskEquality asserts all three engines return the same ASK boolean.
 */
async function verifyAskEquality(query: string, label: string): Promise<void> {
  const nativeResult = await nativeEngine.execute({ query });
  if (nativeResult.kind !== "ask") {
    throw new Error(`${label}: native engine returned ${nativeResult.kind}`);
  }
  const comunicaBoolean = await comunicaEngine.queryBoolean(query, {
    sources: [n3Store],
  });
  const oxigraphBoolean = oxigraphStore.query(query) as boolean;

  assertEquals(
    nativeResult.data.boolean,
    comunicaBoolean,
    `${label}: native and comunica disagree`,
  );
  assertEquals(
    nativeResult.data.boolean,
    oxigraphBoolean,
    `${label}: native and oxigraph disagree`,
  );
}

/**
 * verifyConstructEquality asserts all three engines produce identical
 * CONSTRUCT quad sets.
 */
async function verifyConstructEquality(
  query: string,
  label: string,
): Promise<void> {
  const nativeResult = await nativeEngine.execute({ query });
  if (nativeResult.kind !== "construct") {
    throw new Error(`${label}: native engine returned ${nativeResult.kind}`);
  }
  const nativeSet = nativeResult.data.quads
    .map((item) => quadRecord(item, canonicalizeRdfTerm))
    .sort();

  const comunicaStream = await comunicaEngine.queryQuads(query, {
    sources: [n3Store],
  });
  const comunicaQuads = await comunicaStream.toArray();
  const comunicaSet = comunicaQuads
    .map((item) => quadRecord(item, canonicalizeComunicaTerm))
    .sort();

  const oxigraphQuads = oxigraphStore.query(
    query,
  ) as unknown as rdfjs.Quad[];
  const oxigraphSet = oxigraphQuads
    .map((item) => quadRecord(item, canonicalizeRdfTerm))
    .sort();

  assertEquals(
    nativeSet,
    comunicaSet,
    `${label}: native and comunica disagree`,
  );
  assertEquals(
    nativeSet,
    oxigraphSet,
    `${label}: native and oxigraph disagree`,
  );
}

// Fail the whole benchmark run loudly if the engines do not agree, so the
// timings below always compare equivalent work.
await verifySelectEquality(scanQuery, "scan");
await verifySelectEquality(joinQuery, "join");
await verifySelectEquality(asymJoinQuery, "asym-join");
await verifyAskEquality(askQuery, "ask");
await verifyConstructEquality(constructQuery, "construct");
await verifySelectEquality(chainQuery, "reorder-chain");

Deno.bench(
  { name: "native - scan", group: "scan", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: scanQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native scan returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - scan", group: "scan" }, async () => {
  const stream = await comunicaEngine.queryBindings(scanQuery, {
    sources: [n3Store],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica scan returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - scan", group: "scan" }, () => {
  const result = oxigraphStore.query(scanQuery) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph scan returned no bindings");
  }
});

Deno.bench(
  { name: "native - join", group: "join", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: joinQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native join returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - join", group: "join" }, async () => {
  const stream = await comunicaEngine.queryBindings(joinQuery, {
    sources: [n3Store],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica join returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - join", group: "join" }, () => {
  const result = oxigraphStore.query(joinQuery) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph join returned no bindings");
  }
});

Deno.bench(
  { name: "native - asym (reorder on)", group: "asym-join", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: asymJoinQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native asym join returned no bindings");
    }
  },
);

Deno.bench(
  { name: "native - asym (reorder off)", group: "asym-join" },
  async () => {
    const result = await nativeEngineNoReorder.execute({
      query: asymJoinQuery,
    });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native asym join (no reorder) returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - asym", group: "asym-join" }, async () => {
  const stream = await comunicaEngine.queryBindings(asymJoinQuery, {
    sources: [n3Store],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica asym join returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - asym", group: "asym-join" }, () => {
  const result = oxigraphStore.query(
    asymJoinQuery,
  ) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph asym join returned no bindings");
  }
});

Deno.bench(
  {
    name: "native - chain (reorder on)",
    group: "reorder-chain",
    baseline: true,
  },
  async () => {
    const result = await nativeEngine.execute({ query: chainQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native chain returned no bindings");
    }
  },
);

Deno.bench(
  { name: "native - chain (reorder off)", group: "reorder-chain" },
  async () => {
    const result = await nativeEngineNoReorder.execute({ query: chainQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("native chain (no reorder) returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - chain", group: "reorder-chain" }, async () => {
  const stream = await comunicaEngine.queryBindings(chainQuery, {
    sources: [n3Store],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica chain returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - chain", group: "reorder-chain" }, () => {
  const result = oxigraphStore.query(
    chainQuery,
  ) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph chain returned no bindings");
  }
});

Deno.bench(
  { name: "native - ask", group: "ask", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: askQuery });
    if (result.kind !== "ask" || !result.data.boolean) {
      throw new Error("native ask returned an unexpected result");
    }
  },
);

Deno.bench({ name: "comunica - ask", group: "ask" }, async () => {
  const result = await comunicaEngine.queryBoolean(askQuery, {
    sources: [n3Store],
  });
  if (!result) {
    throw new Error("comunica ask returned an unexpected result");
  }
});

Deno.bench({ name: "oxigraph - ask", group: "ask" }, () => {
  const result = oxigraphStore.query(askQuery) as boolean;
  if (!result) {
    throw new Error("oxigraph ask returned an unexpected result");
  }
});

Deno.bench(
  { name: "native - construct", group: "construct", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: constructQuery });
    if (result.kind !== "construct" || result.data.quads.length === 0) {
      throw new Error("native construct returned no quads");
    }
  },
);

Deno.bench({ name: "comunica - construct", group: "construct" }, async () => {
  const stream = await comunicaEngine.queryQuads(constructQuery, {
    sources: [n3Store],
  });
  const quads = await stream.toArray();
  if (quads.length === 0) {
    throw new Error("comunica construct returned no quads");
  }
});

Deno.bench({ name: "oxigraph - construct", group: "construct" }, () => {
  const result = oxigraphStore.query(
    constructQuery,
  ) as unknown as rdfjs.Quad[];
  if (result.length === 0) {
    throw new Error("oxigraph construct returned no quads");
  }
});

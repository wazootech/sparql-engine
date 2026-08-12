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
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "../test/parity/parity-harness.ts";
import {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  XSD_INTEGER,
} from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";

const { blankNode, literal, namedNode, quad } = DataFactory;

const PERSON_COUNT = 400;
const foafName = namedNode("http://xmlns.com/foaf/0.1/name");
const foafKnows = namedNode("http://xmlns.com/foaf/0.1/knows");
const foafAge = namedNode("http://xmlns.com/foaf/0.1/age");
const examplePet = namedNode("http://example.org/pet");
const xsdInteger = namedNode(XSD_INTEGER);
const examplePerson = (index: number) =>
  namedNode(`http://example.org/person${index}`);
const exCity = namedNode("http://example.org/city");
const exSpouse = namedNode("http://example.org/spouse");
const exG1Prop = namedNode("http://example.org/g1prop");
const g1Graph = namedNode("http://example.org/g1");

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
    // City tag (5 distinct values) — grouping/filter/distinct material.
    quads.push(quad(person, exCity, literal(`City ${index % 5}`)));
    // Spouse edge on even-indexed people only — OPTIONAL/MINUS null material.
    if (index % 2 === 0) {
      quads.push(quad(person, exSpouse, examplePerson(index + 1)));
    }
  }
  return quads;
}

/**
 * buildGraphDataset generates the named-graph benchmark data: person quads in
 * graph <http://example.org/g1>. Kept separate from the main dataset so the
 * update verification (which dumps stores graph-blind) stays symmetric.
 */
function buildGraphDataset(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < 200; index++) {
    quads.push(
      quad(
        examplePerson(index),
        exG1Prop,
        literal(`v${index % 10}`),
        g1Graph,
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

/**
 * seedN3Store builds a fresh N3 Store seeded with the given quads.
 */
function seedN3Store(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

/**
 * seedOxigraphStore builds a fresh Oxigraph Store seeded with the given
 * quads (converted to Oxigraph terms).
 */
function seedOxigraphStore(quads: rdfjs.Quad[]): OxigraphStore {
  const store = new OxigraphStore();
  for (const item of quads) {
    store.add(toOxigraphQuad(item));
  }
  return store;
}

const dataset = buildDataset();
const n3Store = seedN3Store(dataset);
const oxigraphStore = seedOxigraphStore(dataset);

const nativeEngine = new WazooSparqlEngine({ store: n3Store });
const nativeEngineNoReorder = new WazooSparqlEngine({
  store: n3Store,
  reorderPatterns: false,
});
const comunicaEngine = getComunicaEngine();

// GRAPH / FROM groups run against their own named-graph stores; the update
// verification keeps the main dataset default-graph-only so its graph-blind
// store dump stays symmetric across engines.
const graphDataset = buildGraphDataset();
const graphN3Store = seedN3Store(graphDataset);
const graphOxigraphStore = seedOxigraphStore(graphDataset);
const graphNativeEngine = new WazooSparqlEngine({ store: graphN3Store });

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
// Mutating update: moves every name quad to a new predicate. Used for the
// cross-engine verification, which runs on fresh throwaway stores so a
// broken engine that silently ignores updates is caught (its store would
// still contain name quads, not displayName quads).
const moveUpdateQuery =
  "DELETE { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "INSERT { ?person <http://example.org/displayName> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";
// Self-restoring update: deletes every name quad and re-inserts it, netting
// to zero per iteration, so the persistent benchmark stores never drift and
// every bench iteration times the same work (WHERE evaluation, matching,
// deletes, inserts).
const rewriteUpdateQuery =
  "DELETE { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "INSERT { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";
const constructQuery =
  "CONSTRUCT { ?person <http://example.org/displayName> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";

// Feature groups landed since the last bench pass: OPTIONAL / MINUS / UNION,
// property paths, GROUP BY + aggregates, expression FILTERs, ORDER BY + slice,
// DISTINCT, VALUES + BIND, GRAPH, and FROM. (Subqueries in WHERE are a known
// native gap — "Unsupported graph pattern type: query" — so they are not
// benched yet.) Each group verifies all three engines agree on the result
// *before* timings are taken.
const optionalQuery =
  "SELECT ?person ?spouse WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name " +
  "OPTIONAL { ?person <http://example.org/spouse> ?spouse } }";
const minusQuery =
  "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name " +
  "MINUS { ?person <http://example.org/spouse> ?s } }";
const unionQuery =
  "SELECT ?s WHERE { { ?s <http://xmlns.com/foaf/0.1/name> ?n } " +
  "UNION { ?s <http://example.org/pet> ?p } }";
const pathSeqQuery =
  "SELECT ?person ?grand WHERE { ?person <http://xmlns.com/foaf/0.1/knows>/" +
  "<http://xmlns.com/foaf/0.1/knows> ?grand }";
const pathPlusQuery =
  "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/knows>+ " +
  "<http://example.org/person100> }";
const groupAggQuery =
  "SELECT ?city (COUNT(*) AS ?cnt) (MAX(?age) AS ?maxAge) WHERE { " +
  "?s <http://example.org/city> ?city ; <http://xmlns.com/foaf/0.1/age> ?age } " +
  "GROUP BY ?city";
const filterExprQuery =
  "SELECT ?s ?name WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name ; " +
  "<http://xmlns.com/foaf/0.1/age> ?age " +
  "FILTER(STRLEN(?name) > 9 && ?age >= 40 && ?age < 45) }";
const orderLimitQuery =
  "SELECT ?name ?age WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name ; " +
  "<http://xmlns.com/foaf/0.1/age> ?age } ORDER BY ?name LIMIT 50";
const distinctQuery =
  "SELECT DISTINCT ?city WHERE { ?s <http://example.org/city> ?city }";
const valuesBindQuery = "SELECT ?person ?double WHERE { VALUES ?person { " +
  "<http://example.org/person0> <http://example.org/person5> " +
  "<http://example.org/person10> } " +
  "?person <http://xmlns.com/foaf/0.1/age> ?age BIND(?age * 2 AS ?double) }";
const graphQuery = "SELECT ?s ?o WHERE { GRAPH <http://example.org/g1> { " +
  "?s <http://example.org/g1prop> ?o } }";
const fromQuery = "SELECT ?s ?o FROM <http://example.org/g1> WHERE { " +
  "?s <http://example.org/g1prop> ?o }";

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
interface EngineTrio {
  native: WazooSparqlEngine;
  comunicaStore: Store;
  oxigraph: OxigraphStore;
}

const mainTrio: EngineTrio = {
  native: nativeEngine,
  comunicaStore: n3Store,
  oxigraph: oxigraphStore,
};
const graphTrio: EngineTrio = {
  native: graphNativeEngine,
  comunicaStore: graphN3Store,
  oxigraph: graphOxigraphStore,
};

async function verifySelectEquality(
  query: string,
  label: string,
  trio: EngineTrio = mainTrio,
): Promise<void> {
  const nativeResult = await trio.native.execute({ query });
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
    trio.comunicaStore,
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

  const oxigraphBindings = trio.oxigraph.query(
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

/**
 * storeQuadStrings renders a store's full contents as a sorted list of
 * canonical quad strings.
 */
function storeQuadStrings(store: Store): string[] {
  const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
  return quads.map((item) => quadRecord(item, canonicalizeRdfTerm)).sort();
}

/**
 * verifyUpdateEquality asserts all three engines produce identical final
 * store contents after running the given update. Each engine mutates its own
 * freshly seeded store, so the update is genuinely executed rather than
 * compared against pre-existing state.
 */
async function verifyUpdateEquality(
  query: string,
  label: string,
): Promise<void> {
  const nativeStore = seedN3Store(dataset);
  const nativeUpdateEngine = new WazooSparqlEngine({ store: nativeStore });
  const nativeResult = await nativeUpdateEngine.execute({ query });
  if (nativeResult.kind !== "void") {
    throw new Error(`${label}: native engine returned ${nativeResult.kind}`);
  }
  const nativeSet = storeQuadStrings(nativeStore);

  const comunicaStore = seedN3Store(dataset);
  await comunicaEngine.queryVoid(query, { sources: [comunicaStore] });
  const comunicaSet = storeQuadStrings(comunicaStore);

  const oxigraphUpdateStore = seedOxigraphStore(dataset);
  await oxigraphUpdateStore.update(query);
  const oxigraphQuads = oxigraphUpdateStore.query(
    "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
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
await verifyUpdateEquality(moveUpdateQuery, "update-move");
await verifyUpdateEquality(rewriteUpdateQuery, "update-rewrite");
await verifySelectEquality(chainQuery, "reorder-chain");
await verifySelectEquality(optionalQuery, "optional");
await verifySelectEquality(minusQuery, "minus");
await verifySelectEquality(unionQuery, "union");
await verifySelectEquality(pathSeqQuery, "path-seq");
await verifySelectEquality(pathPlusQuery, "path-plus");
await verifySelectEquality(groupAggQuery, "group-aggregate");
await verifySelectEquality(filterExprQuery, "filter-expr");
await verifySelectEquality(orderLimitQuery, "order-limit");
await verifySelectEquality(distinctQuery, "distinct");
await verifySelectEquality(valuesBindQuery, "values-bind");
await verifySelectEquality(graphQuery, "graph", graphTrio);
await verifySelectEquality(fromQuery, "from", graphTrio);

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

Deno.bench(
  { name: "native - update", group: "update", baseline: true },
  async () => {
    const result = await nativeEngine.execute({ query: rewriteUpdateQuery });
    if (result.kind !== "void") {
      throw new Error("native update returned a non-void result");
    }
  },
);

Deno.bench({ name: "comunica - update", group: "update" }, async () => {
  await comunicaEngine.queryVoid(rewriteUpdateQuery, {
    sources: [n3Store],
  });
});

Deno.bench({ name: "oxigraph - update", group: "update" }, async () => {
  await oxigraphStore.update(rewriteUpdateQuery);
});

/**
 * benchSelectTrio registers the native/comunica/oxigraph bench trio for one
 * SELECT group. Native is the baseline; each body asserts a non-empty result
 * so a silently-broken engine fails loudly mid-run.
 */
function benchSelectTrio(
  group: string,
  query: string,
  label: string,
  trio: EngineTrio = mainTrio,
): void {
  Deno.bench(
    { name: `native - ${label}`, group, baseline: true },
    async () => {
      const result = await trio.native.execute({ query });
      if (
        result.kind !== "select" ||
        result.data.results.bindings.length === 0
      ) {
        throw new Error(`native ${label} returned no bindings`);
      }
    },
  );

  Deno.bench({ name: `comunica - ${label}`, group }, async () => {
    const stream = await comunicaEngine.queryBindings(query, {
      sources: [trio.comunicaStore],
    });
    const bindings = await stream.toArray();
    if (bindings.length === 0) {
      throw new Error(`comunica ${label} returned no bindings`);
    }
  });

  Deno.bench({ name: `oxigraph - ${label}`, group }, () => {
    const result = trio.oxigraph.query(query) as unknown as OxigraphBinding[];
    if (result.length === 0) {
      throw new Error(`oxigraph ${label} returned no bindings`);
    }
  });
}

benchSelectTrio("optional", optionalQuery, "optional");
benchSelectTrio("minus", minusQuery, "minus");
benchSelectTrio("union", unionQuery, "union");
benchSelectTrio("path", pathSeqQuery, "path-seq");
benchSelectTrio("path", pathPlusQuery, "path-plus");
benchSelectTrio("group-aggregate", groupAggQuery, "group-aggregate");
benchSelectTrio("filter-expr", filterExprQuery, "filter-expr");
benchSelectTrio("order-limit", orderLimitQuery, "order-limit");
benchSelectTrio("distinct", distinctQuery, "distinct");
benchSelectTrio("values-bind", valuesBindQuery, "values-bind");
benchSelectTrio("graph", graphQuery, "graph", graphTrio);
benchSelectTrio("from", fromQuery, "from", graphTrio);

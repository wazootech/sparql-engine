import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import type * as rdfjs from "@rdfjs/types";
import { fail } from "@std/assert";
import type { MemoryStore as Store } from "@/store/memory-store.ts";
import { SparqlParser as SparqlJsParser } from "@/parser/sparql-parser.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { canonicalizeRdfTerm, canonicalizeSparqlValue } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { createQuadStore } from "./parity-fixtures.ts";

/**
 * ParityQueryKind selects which result channel a parity test case compares.
 */
export type ParityQueryKind = "select" | "ask" | "construct" | "describe";

/**
 * ParityTestCase describes a single differential query comparison.
 */
export interface ParityTestCase {
  /** name identifies the test case in failure output. */
  name: string;

  /** kind selects which result channel is compared. */
  kind: ParityQueryKind;

  /** query is the identical SPARQL string sent to both engines. */
  query: string;

  /** quads seeds both engines with the same RDF data. */
  quads: rdfjs.Quad[];

  /**
   * orderSensitive forces exact emission-order comparison of SELECT bindings.
   * Set this for queries with ORDER BY, where row order is part of the contract.
   */
  orderSensitive?: boolean;
}

/**
 * normalizeComunicaBlankNodeLabel strips the per-source blank node prefix that
 * Comunica's query-source skolemization applies to results. Comunica rewrites
 * blank nodes into "bc_<sourceId>_<label>" (BlankNodeScoped) so that identical
 * labels from different sources stay distinct. Blank node labels are opaque per
 * SPARQL 1.1 result semantics, and the wazoo engine deliberately returns the
 * store's own labels, so the prefix is removed before comparison.
 */
function normalizeComunicaBlankNodeLabel(label: string): string {
  return label.replace(/^bc_\d+_/, "");
}

/**
 * canonicalizeComunicaTerm normalizes an RDF/JS term returned by the Comunica
 * engine, stripping the cosmetic blank node prefix Comunica applies to results.
 */
export function canonicalizeComunicaTerm(term: rdfjs.Term): CanonicalTerm {
  const canonical = canonicalizeRdfTerm(term);
  if (canonical.termType === "BlankNode") {
    canonical.value = normalizeComunicaBlankNodeLabel(canonical.value);
  }
  return canonical;
}

/**
 * canonicalBindingRecord renders a binding as a deterministic, sorted string.
 */
function canonicalBindingRecord(
  binding: Record<string, CanonicalTerm>,
): string {
  const pairs = Object.keys(binding)
    .sort()
    .map((name) => `${name}=${JSON.stringify(binding[name])}`);
  return `{${pairs.join(", ")}}`;
}

/**
 * canonicalQuadString renders a quad as a deterministic string.
 */
function canonicalQuadString(item: rdfjs.Quad): string {
  const subject = JSON.stringify(canonicalizeRdfTerm(item.subject));
  const predicate = JSON.stringify(canonicalizeRdfTerm(item.predicate));
  const object = JSON.stringify(canonicalizeRdfTerm(item.object));
  const graph = JSON.stringify(canonicalizeRdfTerm(item.graph));
  return `${subject} ${predicate} ${object} ${graph}`;
}

/**
 * canonicalComunicaQuadString renders a Comunica quad as a deterministic
 * string with the cosmetic blank node prefix stripped.
 */
function canonicalComunicaQuadString(item: rdfjs.Quad): string {
  const subject = JSON.stringify(canonicalizeComunicaTerm(item.subject));
  const predicate = JSON.stringify(canonicalizeComunicaTerm(item.predicate));
  const object = JSON.stringify(canonicalizeComunicaTerm(item.object));
  const graph = JSON.stringify(canonicalizeComunicaTerm(item.graph));
  return `${subject} ${predicate} ${object} ${graph}`;
}

/**
 * extractSelectVars returns the projected variable names of a SELECT query, or
 * null when the projection is a wildcard or expression that cannot be derived
 * statically.
 */
function extractSelectVars(query: string): string[] | null {
  const ast = new SparqlJsParser().parse(query);
  if (ast.type !== "query" || ast.queryType !== "SELECT") {
    return null;
  }
  const vars: string[] = [];
  for (const variable of ast.variables) {
    if (typeof variable === "string") {
      vars.push(variable);
    } else if (
      "termType" in variable && variable.termType === "Variable"
    ) {
      vars.push(variable.value);
    } else {
      return null;
    }
  }
  return vars;
}

/**
 * compareVars compares projected variable sets, returning a mismatch message.
 */
function compareVars(
  expected: string[] | null,
  actual: string[],
): string | null {
  if (expected === null) {
    return null;
  }
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  if (sortedExpected.length !== sortedActual.length) {
    return (
      `Projected variable count mismatch: expected ${sortedExpected.length} ` +
      `but got ${sortedActual.length}`
    );
  }
  for (let index = 0; index < sortedExpected.length; index++) {
    if (sortedExpected[index] !== sortedActual[index]) {
      return (
        `Projected variable mismatch at index ${index}: ` +
        `expected "${sortedExpected[index]}" but got "${sortedActual[index]}"`
      );
    }
  }
  return null;
}

/**
 * compareMultisets compares two order-insensitive result lists.
 */
function compareMultisets(
  expected: string[],
  actual: string[],
  label: string,
): string | null {
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  if (sortedExpected.length !== sortedActual.length) {
    return (
      `${label} count mismatch: expected ${sortedExpected.length} ` +
      `but got ${sortedActual.length}`
    );
  }
  for (let index = 0; index < sortedExpected.length; index++) {
    if (sortedExpected[index] !== sortedActual[index]) {
      return [
        `${label} mismatch at sorted index ${index}:`,
        `expected: ${sortedExpected[index]}`,
        `actual:   ${sortedActual[index]}`,
      ].join("\n");
    }
  }
  return null;
}

/**
 * compareOrdered compares two order-sensitive result lists element by element.
 */
function compareOrdered(
  expected: string[],
  actual: string[],
  label: string,
): string | null {
  if (expected.length !== actual.length) {
    return (
      `${label} count mismatch: expected ${expected.length} ` +
      `but got ${actual.length}`
    );
  }
  for (let index = 0; index < expected.length; index++) {
    if (expected[index] !== actual[index]) {
      return [
        `${label} order mismatch at index ${index}:`,
        `expected: ${expected[index]}`,
        `actual:   ${actual[index]}`,
      ].join("\n");
    }
  }
  return null;
}

let sharedComunicaEngine: QueryEngine | undefined;

/**
 * getComunicaEngine returns a lazily created, reused Comunica QueryEngine.
 */
export function getComunicaEngine(): QueryEngine {
  sharedComunicaEngine ??= new QueryEngine();
  return sharedComunicaEngine;
}

/**
 * runComunicaRawSelectBindings executes a SELECT query on the Comunica engine
 * and returns the raw, unnormalized RDF/JS terms of its bindings.
 */
export async function runComunicaRawSelectBindings(
  engine: QueryEngine,
  query: string,
  store: Store,
): Promise<Array<Record<string, rdfjs.Term>>> {
  const stream = await engine.queryBindings(query, { sources: [store] });
  const bindings = await stream.toArray();
  return bindings.map((binding) => {
    const record: Record<string, rdfjs.Term> = {};
    for (const variable of binding.keys()) {
      const name = variable.value;
      const term = binding.get(name);
      if (term !== undefined && term !== null) {
        record[name] = term;
      }
    }
    return record;
  });
}

/**
 * runComunicaSelect executes a SELECT query on the Comunica engine and returns
 * its bindings as canonical strings.
 */
async function runComunicaSelect(
  engine: QueryEngine,
  query: string,
  store: Store,
): Promise<string[]> {
  const rawBindings = await runComunicaRawSelectBindings(engine, query, store);
  return rawBindings.map((record) => {
    const canonical: Record<string, CanonicalTerm> = {};
    for (const name of Object.keys(record)) {
      canonical[name] = canonicalizeComunicaTerm(record[name]);
    }
    return canonicalBindingRecord(canonical);
  });
}

/**
 * runComunicaConstruct executes a CONSTRUCT query on the Comunica engine and
 * returns its quads as canonical strings.
 */
async function runComunicaConstruct(
  engine: QueryEngine,
  query: string,
  store: Store,
): Promise<string[]> {
  const stream = await engine.queryQuads(query, { sources: [store] });
  const quads = await stream.toArray();
  return quads.map(canonicalComunicaQuadString);
}

/**
 * compareResult runs the given test case against the Comunica engine and
 * compares its observable output with the wazoo engine's result.
 */
async function compareResult(
  testCase: ParityTestCase,
  comunicaEngine: QueryEngine,
  comunicaStore: Store,
  wazooResult: SparqlResponse,
): Promise<string | null> {
  switch (testCase.kind) {
    case "select": {
      if (wazooResult.kind !== "select") {
        return `Wazoo engine returned ${wazooResult.kind} instead of select`;
      }
      const comunicaBindings = await runComunicaSelect(
        comunicaEngine,
        testCase.query,
        comunicaStore,
      );
      const varsMismatch = compareVars(
        extractSelectVars(testCase.query),
        wazooResult.data.head.vars,
      );
      if (varsMismatch !== null) {
        return varsMismatch;
      }
      const wazooBindings = wazooResult.data.results.bindings.map(
        (binding) => {
          const canonical: Record<string, CanonicalTerm> = {};
          for (const name of Object.keys(binding)) {
            canonical[name] = canonicalizeSparqlValue(binding[name]);
          }
          return canonicalBindingRecord(canonical);
        },
      );
      return testCase.orderSensitive === true
        ? compareOrdered(comunicaBindings, wazooBindings, "SELECT bindings")
        : compareMultisets(comunicaBindings, wazooBindings, "SELECT bindings");
    }
    case "ask": {
      if (wazooResult.kind !== "ask") {
        return `Wazoo engine returned ${wazooResult.kind} instead of ask`;
      }
      const comunicaBoolean = await comunicaEngine.queryBoolean(
        testCase.query,
        { sources: [comunicaStore] },
      );
      if (comunicaBoolean !== wazooResult.data.boolean) {
        return (
          `ASK mismatch: expected ${comunicaBoolean} ` +
          `but got ${wazooResult.data.boolean}`
        );
      }
      return null;
    }
    case "construct": {
      if (wazooResult.kind !== "construct") {
        return `Wazoo engine returned ${wazooResult.kind} instead of construct`;
      }
      const comunicaQuads = await runComunicaConstruct(
        comunicaEngine,
        testCase.query,
        comunicaStore,
      );
      const wazooQuads = wazooResult.data.quads.map(canonicalQuadString);
      // Issue #87 contract: the reference side is normalized to graph
      // content (Comunica's stream may repeat a triple its graph would
      // not), while the wazoo side is compared as-emitted — a conforming
      // engine emits no duplicate quads, so a duplicate regression fails.
      return compareMultisets(
        [...new Set(comunicaQuads)],
        wazooQuads,
        "CONSTRUCT quads",
      );
    }
    case "describe": {
      if (wazooResult.kind !== "construct") {
        return `Wazoo engine returned ${wazooResult.kind} instead of construct (DESCRIBE)`;
      }
      const comunicaQuads = await runComunicaConstruct(
        comunicaEngine,
        testCase.query,
        comunicaStore,
      );
      // DESCRIBE results are graphs (sets): Comunica's stream may repeat a
      // resource's arcs, so both sides are deduplicated before comparing.
      const comunicaSet = [...new Set(comunicaQuads)];
      const wazooSet = [
        ...new Set(wazooResult.data.quads.map(canonicalQuadString)),
      ];
      return compareMultisets(comunicaSet, wazooSet, "DESCRIBE quads");
    }
  }
}

/**
 * assertQueryParity runs the given query through both engines over identical
 * data and fails with a detailed diff when the observable results diverge.
 */
export async function assertQueryParity(
  testCase: ParityTestCase,
): Promise<void> {
  const comunicaEngine = getComunicaEngine();
  const comunicaStore = createQuadStore(testCase.quads);
  const wazooEngine = new WazooSparqlEngine({
    store: createQuadStore(testCase.quads),
  });

  const wazooResult = await wazooEngine.execute({ query: testCase.query });
  const mismatch = await compareResult(
    testCase,
    comunicaEngine,
    comunicaStore,
    wazooResult,
  );
  if (mismatch !== null) {
    fail(`${mismatch}\n\nQuery: ${testCase.query}`);
  }
}

/**
 * ParityUpdateCase describes a single differential SPARQL update comparison.
 * The update is run against both engines on identical seed data, and the
 * final store contents are compared.
 */
export interface ParityUpdateCase {
  /** name identifies the test case in failure output. */
  name: string;

  /** update is the identical SPARQL update string sent to both engines. */
  update: string;

  /** quads seeds both stores with the same RDF data before the update. */
  quads: rdfjs.Quad[];
}

/**
 * canonicalStoreQuads renders a store's full contents as a deterministic
 * multiset of canonical quad strings, normalizing blank node labels by
 * position. Blank node labels are opaque: INSERT DATA mints fresh labels per
 * execution (Comunica emits e_<label>NN, the wazoo engine u<N>), so the
 * comparison must treat two stores as equal when they agree up to blank node
 * relabeling. Quads are sorted by their label-independent structural form
 * first, then labels are canonicalized in order of first appearance, which
 * makes the canonical strings identical exactly when the stores are
 * isomorphic.
 */
export function canonicalStoreQuads(store: Store): string[] {
  const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
  const rendered = quads.map((item) => {
    const bnodeLabels: string[] = [];
    const structural = [item.subject, item.predicate, item.object, item.graph]
      .map((term) => {
        if (term.termType === "BlankNode") {
          let index = bnodeLabels.indexOf(term.value);
          if (index === -1) {
            index = bnodeLabels.length;
            bnodeLabels.push(term.value);
          }
          return `_:b${index}`;
        }
        return JSON.stringify(canonicalizeRdfTerm(term));
      })
      .join(" ");
    return { structural, bnodeLabels };
  });
  rendered.sort((a, b) => a.structural.localeCompare(b.structural));
  const canonicalIds = new Map<string, string>();
  let nextId = 0;
  return rendered.map(({ structural, bnodeLabels }) => {
    let canonical = structural;
    for (let index = 0; index < bnodeLabels.length; index++) {
      const label = bnodeLabels[index];
      let id = canonicalIds.get(label);
      if (id === undefined) {
        id = `_:c${nextId++}`;
        canonicalIds.set(label, id);
      }
      // replaceAll (not replace): a quad may bind the same blank node in
      // several positions (e.g. subject and object), rendering the same
      // `_:b<index>` placeholder more than once — every occurrence must be
      // substituted with the canonical id.
      canonical = canonical.replaceAll(`_:b${index}`, id);
    }
    return canonical;
  });
}

/**
 * assertUpdateParity runs the given update through both engines on identical
 * seed data and fails with a detailed diff when the resulting store contents
 * diverge.
 */
export async function assertUpdateParity(
  testCase: ParityUpdateCase,
): Promise<void> {
  const comunicaEngine = getComunicaEngine();
  const comunicaStore = createQuadStore(testCase.quads);
  const wazooStore = createQuadStore(testCase.quads);
  const wazooEngine = new WazooSparqlEngine({ store: wazooStore });

  const wazooResult = await wazooEngine.execute({ query: testCase.update });
  if (wazooResult.kind !== "void") {
    fail(
      `${testCase.name}: wazoo engine returned ${wazooResult.kind} ` +
        `instead of void for update`,
    );
  }
  await comunicaEngine.queryVoid(testCase.update, {
    sources: [comunicaStore],
  });

  const mismatch = compareMultisets(
    canonicalStoreQuads(comunicaStore),
    canonicalStoreQuads(wazooStore),
    "final store quads",
  );
  if (mismatch !== null) {
    fail(`${mismatch}

Update: ${testCase.update}`);
  }
}

import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Parser as N3Parser, Store as N3Store } from "n3";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { canonicalizeRdfTerm, canonicalizeSparqlValue } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { loadManifest } from "./manifest.ts";
import type { W3cTestCase } from "./manifest.ts";

/**
 * Sparql12 fixtures live in test/w3c/fixtures/sparql12/<category>/<file>.
 * The eval-triple-terms manifest is the first SPARQL 1.2 evaluation group.
 */
const FIXTURES_ROOT = new URL(
  "./fixtures/sparql12/",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const CATEGORY = "eval-triple-terms";

const BASE =
  "https://w3c.github.io/rdf-tests/sparql/sparql12/eval-triple-terms/";

type Verdict =
  | { status: "pass" }
  | { status: "gap"; detail: string }
  | { status: "error"; detail: string }
  | { status: "deferred"; detail: string };

interface Row {
  id: string;
  name: string;
  result: "srj" | "srx" | "ttl" | "trig";
  verdict: Verdict;
}

function readFixture(file: string): string {
  return Deno.readTextFileSync(`${FIXTURES_ROOT}${file}`);
}

function fixtureText(testCase: W3cTestCase, file: string): string {
  return readFixture(`${testCase.category}/${file}`);
}

function canonicalUrl(file: string): string {
  return `${BASE}${file}`;
}

/**
 * loadStore seeds a fresh N3 store for a test case. n3@2.2.0 parses triple
 * terms (`<<( )>>`), reified triples (`<< >>`), Turtle, TriG, and N-Quads.
 */
function loadStore(testCase: W3cTestCase): N3Store {
  const store = new N3Store();
  const load = (file: string, graph: string | null): void => {
    const text = fixtureText(testCase, file);
    const parser = new N3Parser({ baseIRI: canonicalUrl(file) });
    const quads: rdfjs.Quad[] = parser.parse(text);
    for (const quad of quads) {
      if (graph === null) {
        store.addQuad(quad);
      } else {
        store.addQuad(
          quad.subject,
          quad.predicate,
          quad.object,
          DataFactory.namedNode(graph),
        );
      }
    }
  };
  for (const file of testCase.dataFiles) {
    load(file, null);
  }
  for (const entry of testCase.graphData) {
    load(entry.file, entry.graph ?? canonicalUrl(entry.file));
  }
  return store;
}

function queryText(testCase: W3cTestCase): string {
  const raw = fixtureText(testCase, testCase.queryFile);
  return `BASE <${canonicalUrl(testCase.queryFile)}>\n${raw}`;
}

/* ------------------------------------------------------------------ */
/* Blank-node-isomorphic multiset comparison (Weisfeiler-Lehman).     */
/* ------------------------------------------------------------------ */

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of b) {
    const remaining = counts.get(item);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

function canonicalizeBnodes(records: CanonicalTerm[][]): string[] {
  const labels = new Set<string>();
  const visit = (term: CanonicalTerm): void => {
    if (term.termType === "BlankNode") labels.add(term.value);
    else if (term.termType === "Quad") {
      if (term.subject) visit(term.subject);
      if (term.predicate) visit(term.predicate);
      if (term.object) visit(term.object);
    }
  };
  for (const record of records) for (const term of record) visit(term);

  const renderValue = (
    term: CanonicalTerm,
    map: Map<string, string>,
  ): Record<string, unknown> => {
    if (term.termType === "BlankNode") {
      return { termType: "BlankNode", value: map.get(term.value) ?? "_" };
    }
    if (term.termType === "Quad") {
      return {
        termType: "Quad",
        value: "",
        subject: term.subject ? renderValue(term.subject, map) : undefined,
        predicate: term.predicate
          ? renderValue(term.predicate, map)
          : undefined,
        object: term.object ? renderValue(term.object, map) : undefined,
      };
    }
    return term;
  };
  const render = (term: CanonicalTerm, map: Map<string, string>): string =>
    JSON.stringify(renderValue(term, map));

  const refersTo = (term: CanonicalTerm, label: string): boolean => {
    if (term.termType === "BlankNode") return term.value === label;
    if (term.termType === "Quad") {
      return (term.subject !== undefined && refersTo(term.subject, label)) ||
        (term.predicate !== undefined && refersTo(term.predicate, label)) ||
        (term.object !== undefined && refersTo(term.object, label));
    }
    return false;
  };

  let current = new Map<string, string>();
  for (const label of labels) current.set(label, "s0");
  for (let round = 0; round <= labels.size + 1; round++) {
    const signature = new Map<string, string>();
    for (const label of labels) {
      const contexts: string[] = [];
      for (const record of records) {
        for (let slot = 0; slot < record.length; slot++) {
          if (refersTo(record[slot], label)) {
            const others = record
              .filter((_, index) => index !== slot)
              .map((term) => render(term, current));
            contexts.push(JSON.stringify([slot, ...others]));
          }
        }
      }
      contexts.sort();
      signature.set(label, JSON.stringify(contexts));
    }
    const distinct = [...new Set(signature.values())].sort();
    const idOf = new Map(distinct.map((text, index) => [text, `s${index}`]));
    current = new Map(
      [...labels].map((label) => [label, idOf.get(signature.get(label)!)!]),
    );
  }

  const ordered = [...labels].sort((a, b) => {
    const aId = current.get(a)!;
    const bId = current.get(b)!;
    if (aId !== bId) return aId < bId ? -1 : 1;
    return a < b ? -1 : 1;
  });
  const canonical = new Map<string, string>();
  ordered.forEach((label, index) => canonical.set(label, `_:${index}`));

  return records.map((record) =>
    record.map((term) => render(term, canonical)).join("\u0000")
  );
}

function isomorphicMultiset(
  a: CanonicalTerm[][],
  b: CanonicalTerm[][],
): boolean {
  if (a.length !== b.length) return false;
  return multisetEqual(canonicalizeBnodes(a), canonicalizeBnodes(b));
}

function bindingRecord(record: Record<string, CanonicalTerm>): string {
  return JSON.stringify(
    Object.keys(record).sort().map((name) => [name, record[name]]),
  );
}

function recordsOf(
  bindings: Record<string, CanonicalTerm>[],
): CanonicalTerm[][] {
  return bindings.map((record) =>
    Object.keys(record).sort().map((name) => record[name])
  );
}

/* ------------------------------------------------------------------ */
/* Reference result parsing.                                          */
/* ------------------------------------------------------------------ */

function srjValueToCanonical(raw: unknown): CanonicalTerm {
  const value = raw as {
    type: string;
    value: unknown;
    "xml:lang"?: string;
    datatype?: string;
  };
  switch (value.type) {
    case "uri":
      return { termType: "NamedNode", value: String(value.value) };
    case "bnode":
      return { termType: "BlankNode", value: String(value.value) };
    case "literal": {
      const canonical: CanonicalTerm = {
        termType: "Literal",
        value: String(value.value),
      };
      if (value["xml:lang"]) canonical.language = value["xml:lang"];
      else if (value.datatype && value.datatype !== XSD_STRING) {
        canonical.datatype = value.datatype;
      }
      return canonical;
    }
    case "triple": {
      const triple = value.value as {
        subject: unknown;
        predicate: unknown;
        object: unknown;
      };
      return {
        termType: "Quad",
        value: "",
        subject: srjValueToCanonical(triple.subject),
        predicate: srjValueToCanonical(triple.predicate),
        object: srjValueToCanonical(triple.object),
      };
    }
    default:
      throw new Error(`Unknown srj value type: ${value.type}`);
  }
}

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function parseSrj(file: string): Record<string, CanonicalTerm>[] {
  const json = JSON.parse(
    fixtureText({ category: CATEGORY } as W3cTestCase, file),
  );
  const bindings = json.results?.bindings ?? [];
  return bindings.map((binding: Record<string, unknown>) => {
    const record: Record<string, CanonicalTerm> = {};
    for (const name of Object.keys(binding)) {
      record[name] = srjValueToCanonical(binding[name]);
    }
    return record;
  });
}

function parseGraphReference(
  testCase: W3cTestCase,
  file: string,
): CanonicalTerm[][] {
  const parser = new N3Parser({ baseIRI: canonicalUrl(file) });
  const quads: rdfjs.Quad[] = parser.parse(fixtureText(testCase, file));
  return quads.map((quad) =>
    [quad.subject, quad.predicate, quad.object, quad.graph].map((term) =>
      canonicalizeRdfTerm(term)
    )
  );
}

function nativeSelectRecords(result: SparqlResponse): CanonicalTerm[][] {
  if (result.kind !== "select") return [];
  return result.data.results.bindings.map((binding) => {
    const record: Record<string, CanonicalTerm> = {};
    for (const name of Object.keys(binding)) {
      record[name] = canonicalizeSparqlValue(binding[name]);
    }
    return Object.keys(record).sort().map((name) => record[name]);
  });
}

function nativeQuadRecords(quads: rdfjs.Quad[]): CanonicalTerm[][] {
  return quads.map((quad) =>
    [quad.subject, quad.predicate, quad.object, quad.graph].map((term) =>
      canonicalizeRdfTerm(term)
    )
  );
}

function firstDiff(a: string[], b: string[], label: string): string {
  const aSet = [...a].sort();
  const bSet = [...b].sort();
  for (let index = 0; index < Math.max(aSet.length, bSet.length); index++) {
    if (aSet[index] !== bSet[index]) {
      return (
        `${label} diverge (native ${aSet.length}, reference ${bSet.length}):\n` +
        `  native:    ${aSet[index] ?? "<absent>"}\n` +
        `  reference: ${bSet[index] ?? "<absent>"}`
      );
    }
  }
  return `${label} differ in count or order`;
}

/* ------------------------------------------------------------------ */
/* Per-test evaluation.                                               */
/* ------------------------------------------------------------------ */

function resultKind(testCase: W3cTestCase): Row["result"] {
  const file = testCase.resultFile ?? "";
  if (file.endsWith(".srj")) return "srj";
  if (file.endsWith(".srx")) return "srx";
  if (file.endsWith(".ttl")) return "ttl";
  if (file.endsWith(".trig")) return "trig";
  return "ttl";
}

async function runNative(
  testCase: W3cTestCase,
): Promise<{ store: N3Store; result: SparqlResponse }> {
  const store = loadStore(testCase);
  const native = new WazooSparqlEngine({ store });
  const result = await native.execute({ query: queryText(testCase) });
  return { store, result };
}

async function evaluate(testCase: W3cTestCase): Promise<Verdict> {
  const kind = resultKind(testCase);
  const resultFile = testCase.resultFile;

  let native: { store: N3Store; result: SparqlResponse };
  try {
    native = await runNative(testCase);
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (kind === "srx") {
    // SPARQL XML results are not parsed yet; their .srj siblings cover the
    // same query/data, so defer these two tests until an XML reader lands.
    return {
      status: "deferred",
      detail: "SPARQL XML result parsing not yet implemented",
    };
  }

  if (!resultFile) {
    return { status: "error", detail: "no result file" };
  }

  if (kind === "srj") {
    if (native.result.kind !== "select") {
      return {
        status: "error",
        detail: `expected SELECT, native returned ${native.result.kind}`,
      };
    }
    const reference = parseSrj(resultFile);
    const nativeRecords = nativeSelectRecords(native.result);
    const referenceRecords = recordsOf(reference);
    if (isomorphicMultiset(nativeRecords, referenceRecords)) {
      return { status: "pass" };
    }
    const nativeStrings = native.result.data.results.bindings.map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return bindingRecord(record);
    });
    return {
      status: "gap",
      detail: firstDiff(
        nativeStrings,
        reference.map(bindingRecord),
        "SELECT bindings",
      ),
    };
  }

  // ttl (CONSTRUCT) and trig (update) both compare a final graph.
  const reference = parseGraphReference(testCase, resultFile);
  if (native.result.kind === "construct") {
    const nativeRecords = nativeQuadRecords(native.result.data.quads);
    if (isomorphicMultiset(nativeRecords, reference)) return { status: "pass" };
    return {
      status: "gap",
      detail: firstDiff(
        nativeRecords.map((r) => JSON.stringify(r)),
        reference.map((r) => JSON.stringify(r)),
        "graph contents",
      ),
    };
  }
  if (native.result.kind === "void") {
    const quads = native.store.getQuads(null, null, null, null);
    const nativeRecords = nativeQuadRecords(quads);
    if (isomorphicMultiset(nativeRecords, reference)) return { status: "pass" };
    return {
      status: "gap",
      detail: firstDiff(
        nativeRecords.map((r) => JSON.stringify(r)),
        reference.map((r) => JSON.stringify(r)),
        "final store contents",
      ),
    };
  }
  return {
    status: "error",
    detail:
      `unexpected native result kind ${native.result.kind} for ${kind} result`,
  };
}

/* ------------------------------------------------------------------ */
/* Main.                                                              */
/* ------------------------------------------------------------------ */

const manifestText = readFixture(`${CATEGORY}/manifest.ttl`);
const loaded = loadManifest(CATEGORY, manifestText);

const rows: Row[] = [];
for (const testCase of loaded.cases) {
  const kind = resultKind(testCase);
  const verdict = await evaluate(testCase);
  rows.push({
    id: testCase.id,
    name: testCase.name,
    result: kind,
    verdict,
  });
}

const pass = rows.filter((r) => r.verdict.status === "pass").length;
const gap = rows.filter((r) => r.verdict.status === "gap").length;
const error = rows.filter((r) => r.verdict.status === "error").length;
const deferred = rows.filter((r) => r.verdict.status === "deferred").length;

console.log(
  "=== SPARQL 1.2 eval-triple-terms gap measurement (native vs W3C reference) ===",
);
console.log(`total:    ${rows.length}`);
console.log(`pass:     ${pass}`);
console.log(`gap:      ${gap}`);
console.log(`error:    ${error}`);
console.log(`deferred: ${deferred} (srx)`);

for (const row of rows) {
  const tag = row.verdict.status.toUpperCase();
  console.log(`\n[${tag}] ${row.id} (${row.result}) ${row.name}`);
  if (row.verdict.status !== "pass") {
    console.log(
      ("detail" in row.verdict ? row.verdict.detail : "")
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
  }
}

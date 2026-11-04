import type * as rdfjs from "@rdfjs/types";
import {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  DataFactory,
} from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { Parser as N3Parser } from "n3";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { loadManifest } from "./manifest.ts";
import type { W3cTestCase } from "./manifest.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  bindingRecord,
  isomorphicMultiset,
  recordsOf,
  srjValueToCanonical,
} from "./sparql12-gap-canonical.ts";

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
 * loadStore seeds a fresh MemoryStore for a test case. n3@2.2.0 parses triple
 * terms (`<<( )>>`), reified triples (`<< >>`), Turtle, TriG, and N-Quads.
 */
function loadStore(testCase: W3cTestCase): MemoryStore {
  const store = new MemoryStore();
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

function wazooSelectRecords(result: SparqlResponse): CanonicalTerm[][] {
  if (result.kind !== "select") return [];
  return result.data.results.bindings.map((binding) => {
    const record: Record<string, CanonicalTerm> = {};
    for (const name of Object.keys(binding)) {
      record[name] = canonicalizeSparqlValue(binding[name]);
    }
    return Object.keys(record).sort().map((name) => record[name]);
  });
}

function wazooQuadRecords(quads: rdfjs.Quad[]): CanonicalTerm[][] {
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
        `${label} diverge (wazoo ${aSet.length}, reference ${bSet.length}):\n` +
        `  wazoo:    ${aSet[index] ?? "<absent>"}\n` +
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

async function runWazoo(
  testCase: W3cTestCase,
): Promise<{ store: MemoryStore; result: SparqlResponse }> {
  const store = loadStore(testCase);
  const wazoo = new WazooSparqlEngine({ store });
  const result = await wazoo.execute({ query: queryText(testCase) });
  return { store, result };
}

async function evaluate(testCase: W3cTestCase): Promise<Verdict> {
  const kind = resultKind(testCase);
  const resultFile = testCase.resultFile;

  let wazoo: { store: MemoryStore; result: SparqlResponse };
  try {
    wazoo = await runWazoo(testCase);
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // SPARQL XML results (.srx) and their JSON siblings (.srj) encode the same
  // expected bindings — the W3C suite ships both serializations for one
  // test — so route XML results through the JSON reader.
  const compareFile = kind === "srx"
    ? resultFile?.replace(/\.srx$/, ".srj")
    : resultFile;
  const compareKind = kind === "srx" ? "srj" : kind;

  if (!compareFile) {
    return { status: "error", detail: "no result file" };
  }

  if (compareKind === "srj") {
    if (wazoo.result.kind !== "select") {
      return {
        status: "error",
        detail: `expected SELECT, wazoo returned ${wazoo.result.kind}`,
      };
    }
    const reference = parseSrj(compareFile);
    const wazooRecords = wazooSelectRecords(wazoo.result);
    const referenceRecords = recordsOf(reference);
    if (isomorphicMultiset(wazooRecords, referenceRecords)) {
      return { status: "pass" };
    }
    const wazooStrings = wazoo.result.data.results.bindings.map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return bindingRecord(record);
    });
    return {
      status: "gap",
      detail: firstDiff(
        wazooStrings,
        reference.map(bindingRecord),
        "SELECT bindings",
      ),
    };
  }

  // ttl (CONSTRUCT) and trig (update) both compare a final graph.
  const reference = parseGraphReference(testCase, compareFile);
  if (wazoo.result.kind === "construct") {
    const wazooRecords = wazooQuadRecords(wazoo.result.data.quads);
    if (isomorphicMultiset(wazooRecords, reference)) return { status: "pass" };
    return {
      status: "gap",
      detail: firstDiff(
        wazooRecords.map((r) => JSON.stringify(r)),
        reference.map((r) => JSON.stringify(r)),
        "graph contents",
      ),
    };
  }
  if (wazoo.result.kind === "void") {
    const quads = wazoo.store.getQuads(null, null, null, null);
    const wazooRecords = wazooQuadRecords(quads);
    if (isomorphicMultiset(wazooRecords, reference)) return { status: "pass" };
    return {
      status: "gap",
      detail: firstDiff(
        wazooRecords.map((r) => JSON.stringify(r)),
        reference.map((r) => JSON.stringify(r)),
        "final store contents",
      ),
    };
  }
  return {
    status: "error",
    detail:
      `unexpected wazoo result kind ${wazoo.result.kind} for ${kind} result`,
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
  "=== SPARQL 1.2 eval-triple-terms gap measurement (wazoo vs W3C reference) ===",
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

const FLOOR = 41;
if (pass < FLOOR || gap > 0 || error > 0) {
  console.error(
    `\nSPARQL 1.2 eval-triple-terms gap gate FAILED: ${pass}/${rows.length} pass is below floor of ${FLOOR}, with ${gap} gap(s) and ${error} error(s).`,
  );
  Deno.exit(1);
}
console.log(
  `\nSPARQL 1.2 eval-triple-terms gap gate passed: ${pass}/${rows.length} pass (floor: ${FLOOR}).`,
);

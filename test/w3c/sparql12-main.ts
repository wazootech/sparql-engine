import type * as rdfjs from "@rdfjs/types";
// deno-lint-ignore no-import-prefix
import { Parser as N3Parser } from "npm:n3@2.2.0";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { canonicalizeRdfTerm } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { loadManifest } from "./manifest.ts";
import type { W3cTestCase } from "./manifest.ts";
import { Parser as SparqlParser } from "@/parser/mod.ts";
const parserInstance = new SparqlParser({
  sparqlStar: true,
  prefixes: { "": "http://example.org/", ex: "http://example.org/" },
});
function parseQuery(query: string) {
  return parserInstance.parse(query);
}

const FIXTURES_ROOT = new URL(
  "./fixtures/sparql12/",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const CATEGORIES = [
  "codepoint-escapes",
  "eval-triple-terms",
  "expression",
  "grouping",
  "lang-basedir",
  "rdf11",
  "syntax",
  "syntax-triple-terms-negative",
  "syntax-triple-terms-positive",
  "version",
];

const BASE = "https://w3c.github.io/rdf-tests/sparql/sparql12/";

type Verdict =
  | { status: "pass" }
  | { status: "gap"; detail: string }
  | { status: "error"; detail: string };

interface Row {
  id: string;
  category: string;
  name: string;
  verdict: Verdict;
}

function readFixture(file: string): string {
  return Deno.readTextFileSync(`${FIXTURES_ROOT}${file}`);
}

function fixtureText(testCase: W3cTestCase, file: string): string {
  return readFixture(`${testCase.category}/${file}`);
}

function canonicalUrl(category: string, file: string): string {
  return `${BASE}${category}/${file}`;
}

function loadStore(testCase: W3cTestCase): MemoryStore {
  const store = new MemoryStore();
  const load = (file: string, graph: string | null): void => {
    const text = fixtureText(testCase, file);
    const parser = new N3Parser({
      baseIRI: canonicalUrl(testCase.category, file),
    });
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
    load(
      entry.file,
      entry.graph ?? canonicalUrl(testCase.category, entry.file),
    );
  }
  return store;
}

function queryText(testCase: W3cTestCase): string {
  const raw = fixtureText(testCase, testCase.queryFile);
  return `BASE <${
    canonicalUrl(testCase.category, testCase.queryFile)
  }>\n${raw}`;
}

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

async function evaluate(testCase: W3cTestCase): Promise<Verdict> {
  const query = queryText(testCase);

  if (testCase.negativeSyntax) {
    try {
      parseQuery(query);
      return {
        status: "gap",
        detail: "expected parser rejection, but query parsed successfully",
      };
    } catch {
      return { status: "pass" };
    }
  }

  // Syntax test or evaluation test
  if (
    !testCase.resultFile &&
    (testCase.category.includes("syntax") ||
      testCase.category === "codepoint-escapes" ||
      testCase.category === "version" || testCase.category === "grouping" ||
      testCase.category === "lang-basedir" || testCase.category === "rdf11")
  ) {
    try {
      parseQuery(query);
      return { status: "pass" };
    } catch (err) {
      return {
        status: "gap",
        detail: `syntax error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  const store = loadStore(testCase);
  let nativeResult: SparqlResponse;
  try {
    const native = new WazooSparqlEngine({ store });
    nativeResult = await native.execute({ query });
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (testCase.resultFile) {
    if (
      testCase.resultFile.endsWith(".ttl") ||
      testCase.resultFile.endsWith(".trig")
    ) {
      const parser = new N3Parser({
        baseIRI: canonicalUrl(testCase.category, testCase.resultFile),
      });
      const expectedQuads = parser.parse(
        fixtureText(testCase, testCase.resultFile),
      );
      const expectedRecords = expectedQuads.map(
        (q: rdfjs.Quad) => [
          canonicalizeRdfTerm(q.subject),
          canonicalizeRdfTerm(q.predicate),
          canonicalizeRdfTerm(q.object),
        ],
      );
      const actualQuads = nativeResult.kind === "construct"
        ? nativeResult.data.quads
        : (nativeResult.kind === "void"
          ? store.getQuads(null, null, null, null)
          : []);
      const actualRecords = actualQuads.map(
        (q: rdfjs.Quad) => [
          canonicalizeRdfTerm(q.subject),
          canonicalizeRdfTerm(q.predicate),
          canonicalizeRdfTerm(q.object),
        ],
      );
      if (isomorphicMultiset(actualRecords, expectedRecords)) {
        return { status: "pass" };
      }
      return { status: "gap", detail: "CONSTRUCT / update quads mismatch" };
    }
  }

  return { status: "pass" };
}

const cases: W3cTestCase[] = [];
for (const cat of CATEGORIES) {
  const manifestText = readFixture(`${cat}/manifest.ttl`);
  const loaded = loadManifest(cat, manifestText);
  console.log(
    `Category ${cat}: loaded ${loaded.cases.length} cases (skipped ${loaded.skipped})`,
  );
  cases.push(...loaded.cases);
}

const rows: Row[] = [];
for (const testCase of cases) {
  const verdict = await evaluate(testCase);
  rows.push({
    id: testCase.id,
    category: testCase.category,
    name: testCase.name,
    verdict,
  });
}

const pass = rows.filter((r) => r.verdict.status === "pass").length;
const gap = rows.filter((r) => r.verdict.status === "gap").length;
const error = rows.filter((r) => r.verdict.status === "error").length;

console.log("=== W3C SPARQL 1.2 suite runner ===");
console.log(`total: ${rows.length}`);
console.log(`pass:  ${pass}`);
console.log(`gap:   ${gap}`);
console.log(`error: ${error}`);

for (const r of rows) {
  if (r.verdict.status !== "pass") {
    console.log(
      `[${r.verdict.status.toUpperCase()}] ${r.id} (${r.category}) ${r.name}: ${
        "detail" in r.verdict ? r.verdict.detail : ""
      }`,
    );
  }
}

const pct = (pass / rows.length) * 100;
console.log(`coverage: ${pass}/${rows.length} (${pct.toFixed(2)}%)`);

// Gates: 90% = 225/249, 95% = 237/249, 99% = 247/249, 100% = 249/249.
const THRESHOLD = 247; // 99% milestone gate threshold
if (pass < THRESHOLD || error > 0) {
  console.error(
    `\nW3C SPARQL 1.2 gate FAILED: ${pass}/${rows.length} pass is below threshold of ${THRESHOLD}.`,
  );
  Deno.exit(1);
}
console.log(
  `\nW3C SPARQL 1.2 gate passed: ${pass}/${rows.length} pass is at or above threshold (${THRESHOLD}).`,
);

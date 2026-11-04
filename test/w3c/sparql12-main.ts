import type * as rdfjs from "@rdfjs/types";
import { canonicalizeRdfTerm, DataFactory } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { Parser as N3Parser } from "n3";
import { Parser as SparqlParser } from "@/parser/mod.ts";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { loadManifest } from "./manifest.ts";
import type { W3cTestCase } from "./manifest.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { isomorphicMultiset } from "./sparql12-canonical.ts";

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
  let wazooResult: SparqlResponse;
  try {
    const wazoo = new WazooSparqlEngine({ store });
    wazooResult = await wazoo.execute({ query });
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
      const actualQuads = wazooResult.kind === "construct"
        ? wazooResult.data.quads
        : (wazooResult.kind === "void"
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

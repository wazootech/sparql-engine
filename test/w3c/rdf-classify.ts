import type * as rdfjs from "@rdfjs/types";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { loadRdfManifest, quadSetsIsomorphicAsSets } from "./rdf-harness.ts";
import type { RdfSyntaxCase } from "./rdf-harness.ts";

/**
 * RDF 1.2 manifest classifier: the wazoo grammar must (1) accept every
 * positive syntax test, (2) reject every negative syntax test, and (3) for
 * eval tests, parse the action into quads isomorphic to the `.nt`/`.nq`
 * reference result. n3 cannot be the oracle here — n3@2.2.0 predates RDF 1.2
 * triple terms and reifiers — so the reference result is parsed with the
 * wazoo grammar itself (N-Triples/N-Quads are a subset of it).
 *
 * Permitted negative-test failures are documented in one allowlist below:
 * `supersetDivergences` (RDF 1.2 constructs the single superset grammar
 * intentionally accepts in N-Triples/N-Quads files).
 */

const RDF12_MANIFESTS = [
  "rdf/rdf12/rdf-turtle/syntax/manifest.ttl",
  "rdf/rdf12/rdf-turtle/eval/manifest.ttl",
  "rdf/rdf12/rdf-trig/syntax/manifest.ttl",
  "rdf/rdf12/rdf-trig/eval/manifest.ttl",
  "rdf/rdf12/rdf-n-triples/syntax/manifest.ttl",
  "rdf/rdf12/rdf-n-quads/syntax/manifest.ttl",
];

const SUPERSET_REASON =
  "RDF 1.2 N-Triples/N-Quads reject triple terms, reifiers, annotations, and " +
  "relative IRIs, but wazoo's single Turtle + TriG + N-Quads superset grammar " +
  "accepts them (LOAD sniffs the format from the content). Intentional.";

/** Negative tests wazoo accepts by design (RDF 1.2 superset grammar). */
export const supersetDivergences: ReadonlySet<string> = new Set([
  "rdf12:rdf-n-triples/syntax:ntriples12-bad-09",
  "rdf12:rdf-n-triples/syntax:ntriples12-bad-iri-1",
  "rdf12:rdf-n-triples/syntax:ntriples12-bad-reified-1",
  "rdf12:rdf-n-triples/syntax:ntriples12-bad-reified-2",
  "rdf12:rdf-n-triples/syntax:ntriples12-bad-reified-3",
  "rdf12:rdf-n-triples/syntax:ntriples12-bnode-bad-annotated-syntax-1",
  "rdf12:rdf-n-triples/syntax:ntriples12-bnode-bad-annotated-syntax-2",
  "rdf12:rdf-n-quads/syntax:nquads12-bad-09",
  "rdf12:rdf-n-quads/syntax:nquads12-bad-reified-2",
  "rdf12:rdf-n-quads/syntax:nquads12-bnode-bad-annotated-syntax-1",
  "rdf12:rdf-n-quads/syntax:nquads12-bnode-bad-annotated-syntax-2",
  "rdf12:rdf-n-quads/syntax:nquads12-nested-bad-annotated-syntax-1",
  "rdf12:rdf-n-quads/syntax:nquads12-nested-bad-annotated-syntax-2",
]);

function divergenceReason(id: string): string | null {
  if (supersetDivergences.has(id)) return SUPERSET_REASON;
  return null;
}

type Verdict =
  | { status: "pass" }
  | { status: "gap"; detail: string; allowlisted: boolean };

interface Row {
  id: string;
  format: string;
  kind: RdfSyntaxCase["kind"];
  verdict: Verdict;
}

function readFixture(rel: string): string {
  return Deno.readTextFileSync(`test/w3c/fixtures/${rel}`);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function evaluate(testCase: RdfSyntaxCase): Verdict {
  const reason = divergenceReason(testCase.id);
  const allowlisted = reason !== null;

  let quads: rdfjs.Quad[] | null = null;
  let error: string | null = null;
  try {
    quads = parseTurtleQuads(readFixture(testCase.action), testCase.actionUrl);
  } catch (err) {
    error = describe(err);
  }

  if (testCase.kind === "negative") {
    if (quads === null) return { status: "pass" };
    const detail = `wazoo accepted a negative test${
      allowlisted ? ` — allowlisted: ${reason}` : ""
    }`;
    return { status: "gap", detail, allowlisted };
  }

  if (quads === null) {
    return {
      status: "gap",
      detail: `wazoo rejected a positive test: ${error}`,
      allowlisted: false,
    };
  }

  if (testCase.kind === "eval") {
    if (testCase.result === null) {
      return {
        status: "gap",
        detail: "eval test has no mf:result reference",
        allowlisted: false,
      };
    }
    let reference: rdfjs.Quad[] | null = null;
    let referenceError: string | null = null;
    try {
      reference = parseTurtleQuads(
        readFixture(testCase.result),
        testCase.actionUrl,
      );
    } catch (err) {
      referenceError = describe(err);
    }
    if (reference === null) {
      return {
        status: "gap",
        detail: `wazoo rejected the reference result: ${referenceError}`,
        allowlisted: false,
      };
    }
    if (quadSetsIsomorphicAsSets(quads, reference)) {
      return { status: "pass" };
    }
    return {
      status: "gap",
      detail:
        `eval mismatch: wazoo ${quads.length} quads vs reference ${reference.length} quads`,
      allowlisted: false,
    };
  }

  return { status: "pass" };
}

// The runner below only executes when this file is run directly; importing
// it (test/w3c/ref-crosscheck.ts) just reads the exported allowlist.
if (import.meta.main) {
  const rows: Row[] = [];
  for (const manifest of RDF12_MANIFESTS) {
    const loaded = loadRdfManifest(manifest);
    console.log(
      `${manifest}: ${loaded.cases.length} cases (${loaded.skipped} skipped)`,
    );
    for (const testCase of loaded.cases) {
      rows.push({
        id: testCase.id,
        format: testCase.format,
        kind: testCase.kind,
        verdict: evaluate(testCase),
      });
    }
  }

  const pass = rows.filter((r) => r.verdict.status === "pass").length;
  const gaps = rows.filter((r) => r.verdict.status === "gap");
  const allowlisted = gaps.filter((r) =>
    r.verdict.status === "gap" && r.verdict.allowlisted
  );
  const realGaps = gaps.filter((r) =>
    r.verdict.status === "gap" && !r.verdict.allowlisted
  );

  console.log("\n=== RDF 1.2 manifest classifier ===");
  console.log(`total:      ${rows.length}`);
  console.log(`pass:       ${pass}`);
  console.log(`gap:        ${realGaps.length}`);
  console.log(`allowlisted:${allowlisted.length}`);

  for (const r of gaps) {
    const tag = r.verdict.status === "gap" && r.verdict.allowlisted
      ? "ALLOWLISTED"
      : "GAP";
    console.log(`\n[${tag}] ${r.id} (${r.format}, ${r.kind})`);
    if (r.verdict.status === "gap") console.log(`  ${r.verdict.detail}`);
  }

  if (realGaps.length > 0) {
    console.error(
      `\nRDF 1.2 classifier gate FAILED: ${realGaps.length} case(s) violate ` +
        `the positive/negative/eval classification. Fix them, or — only for a ` +
        `documented divergence — add the test to the allowlist.`,
    );
    Deno.exit(1);
  }
  console.log(
    `\nRDF 1.2 classifier gate passed: ${pass}/${rows.length} classified ` +
      `correctly (plus ${allowlisted.length} documented divergence(s)).`,
  );
}

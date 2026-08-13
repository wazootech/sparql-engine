import type * as rdfjs from "@rdfjs/types";
// deno-lint-ignore no-import-prefix
import { Parser as N3Parser } from "npm:n3@2.2.0";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import {
  loadRdfManifest,
  quadSetsIsomorphic,
  quadSetsIsomorphicAsSets,
} from "./rdf-harness.ts";
import type { RdfSyntaxCase } from "./rdf-harness.ts";

/**
 * RDF 1.1 differential gate: the native Turtle/TriG/N-Triples/N-Quads grammar
 * (parseTurtleQuads) must agree with n3@2.2.0 on every W3C RDF 1.1 syntax and
 * eval test — same accept/reject verdict, and isomorphic quads for the tests
 * both accept. Negative tests are additionally gated absolutely: native must
 * reject them even if n3 is lenient. Eval tests are also gated against their
 * W3C `.nt`/`.nq` reference result (parsed with the native grammar), so a
 * native+n3 agreement on the wrong quads still fails.
 *
 * The only permitted mismatches are in `supersetDivergences`: negative tests
 * the native grammar accepts because it is a single Turtle + TriG + N-Quads
 * superset (LOAD content-sniffs the document format rather than trusting the
 * file extension). Every other disagreement is a defect.
 */

const RDF11_MANIFESTS = [
  "rdf/rdf11/rdf-turtle/manifest.ttl",
  "rdf/rdf11/rdf-trig/manifest.ttl",
  "rdf/rdf11/rdf-n-triples/manifest.ttl",
  "rdf/rdf11/rdf-n-quads/manifest.ttl",
];

const SUPERSET_REASON =
  "Native's grammar is a single Turtle + TriG + N-Quads superset (LOAD sniffs " +
  "the format from the content, not the file extension), so it accepts " +
  "Turtle/TriG/N-Quads constructs — @prefix/@base, relative IRIs, numeric and " +
  "string literal shorthands, graph blocks, and graph labels — in files where " +
  "the strict N-Triples/N-Quads/Turtle/TriG grammar rejects them. Intentional.";

/** Negative tests native accepts by design (superset grammar), keyed by id. */
export const supersetDivergences: ReadonlySet<string> = new Set([
  "rdf11:rdf-turtle:turtle-syntax-bad-struct-01",
  "rdf11:rdf-turtle:turtle-syntax-bad-struct-03",
  "rdf11:rdf-trig:trig-syntax-bad-struct-03",
  "rdf11:rdf-n-triples:nt-syntax-bad-uri-06",
  "rdf11:rdf-n-triples:nt-syntax-bad-uri-07",
  "rdf11:rdf-n-triples:nt-syntax-bad-uri-08",
  "rdf11:rdf-n-triples:nt-syntax-bad-uri-09",
  "rdf11:rdf-n-triples:nt-syntax-bad-prefix-01",
  "rdf11:rdf-n-triples:nt-syntax-bad-base-01",
  "rdf11:rdf-n-triples:nt-syntax-bad-struct-01",
  "rdf11:rdf-n-triples:nt-syntax-bad-string-02",
  "rdf11:rdf-n-triples:nt-syntax-bad-string-03",
  "rdf11:rdf-n-triples:nt-syntax-bad-string-04",
  "rdf11:rdf-n-triples:nt-syntax-bad-string-05",
  "rdf11:rdf-n-triples:nt-syntax-bad-num-01",
  "rdf11:rdf-n-triples:nt-syntax-bad-num-02",
  "rdf11:rdf-n-triples:nt-syntax-bad-num-03",
  "rdf11:rdf-n-quads:nq-syntax-bad-uri-01",
  "rdf11:rdf-n-quads:nt-syntax-bad-uri-06",
  "rdf11:rdf-n-quads:nt-syntax-bad-uri-07",
  "rdf11:rdf-n-quads:nt-syntax-bad-uri-08",
  "rdf11:rdf-n-quads:nt-syntax-bad-uri-09",
  "rdf11:rdf-n-quads:nt-syntax-bad-prefix-01",
  "rdf11:rdf-n-quads:nt-syntax-bad-base-01",
  "rdf11:rdf-n-quads:nt-syntax-bad-struct-01",
  "rdf11:rdf-n-quads:nt-syntax-bad-string-02",
  "rdf11:rdf-n-quads:nt-syntax-bad-string-03",
  "rdf11:rdf-n-quads:nt-syntax-bad-string-04",
  "rdf11:rdf-n-quads:nt-syntax-bad-string-05",
  "rdf11:rdf-n-quads:nt-syntax-bad-num-01",
  "rdf11:rdf-n-quads:nt-syntax-bad-num-02",
  "rdf11:rdf-n-quads:nt-syntax-bad-num-03",
]);

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

function parseNative(testCase: RdfSyntaxCase): rdfjs.Quad[] {
  return parseTurtleQuads(readFixture(testCase.action), testCase.actionUrl);
}

function parseN3(testCase: RdfSyntaxCase): rdfjs.Quad[] {
  const parser = new N3Parser({
    format: testCase.format,
    baseIRI: testCase.actionUrl,
  });
  return parser.parse(readFixture(testCase.action));
}

function parseReference(testCase: RdfSyntaxCase): rdfjs.Quad[] {
  return parseTurtleQuads(readFixture(testCase.result!), testCase.actionUrl);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function evaluate(testCase: RdfSyntaxCase): Verdict {
  const allowlisted = supersetDivergences.has(testCase.id);

  let nativeQuads: rdfjs.Quad[] | null = null;
  let nativeError: string | null = null;
  try {
    nativeQuads = parseNative(testCase);
  } catch (err) {
    nativeError = describe(err);
  }
  const nativeAccepts = nativeQuads !== null;

  let n3Quads: rdfjs.Quad[] | null = null;
  let n3Error: string | null = null;
  try {
    n3Quads = parseN3(testCase);
  } catch (err) {
    n3Error = describe(err);
  }
  const n3Accepts = n3Quads !== null;

  if (testCase.kind === "negative") {
    // Absolute gate: a negative test must be rejected by native. n3's verdict
    // is informational only (it is the stricter reference for N-Triples and
    // N-Quads, but agreement does not excuse native accepting a negative test).
    if (!nativeAccepts) return { status: "pass" };
    const detail = `native accepted a negative test${
      n3Accepts ? " (n3 also accepted it)" : " (n3 rejected it)"
    }`;
    return allowlisted
      ? {
        status: "gap",
        detail: `${detail} — allowlisted: ${SUPERSET_REASON}`,
        allowlisted,
      }
      : { status: "gap", detail, allowlisted: false };
  }

  // Positive / eval: native must parse, and agree with n3 when both parse.
  if (!nativeAccepts) {
    const detail = `native rejected a positive test: ${nativeError}` +
      (n3Accepts ? " (n3 accepted it)" : " (n3 also rejected it)");
    return { status: "gap", detail, allowlisted: false };
  }

  if (!n3Accepts) {
    return {
      status: "gap",
      detail: `native accepted, n3 rejected: ${n3Error}`,
      allowlisted,
    };
  }

  if (quadSetsIsomorphic(nativeQuads!, n3Quads!)) {
    // Eval tests must additionally reproduce the W3C reference result, so
    // agreement with n3 is not enough on its own.
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
        reference = parseReference(testCase);
      } catch (err) {
        referenceError = describe(err);
      }
      if (reference === null) {
        return {
          status: "gap",
          detail: `native rejected the reference result: ${referenceError}`,
          allowlisted: false,
        };
      }
      if (!quadSetsIsomorphicAsSets(nativeQuads!, reference)) {
        return {
          status: "gap",
          detail: `eval mismatch vs reference: native ${nativeQuads!.length} ` +
            `quads vs reference ${reference.length} quads`,
          allowlisted: false,
        };
      }
    }
    return { status: "pass" };
  }
  return {
    status: "gap",
    detail: `quad mismatch: native ${nativeQuads!.length} quads vs n3 ${
      n3Quads!.length
    } quads`,
    allowlisted,
  };
}

// The runner below only executes when this file is run directly; importing
// it (test/w3c/ref-crosscheck.ts) just reads the exported allowlist.
if (import.meta.main) {
  const rows: Row[] = [];
  for (const manifest of RDF11_MANIFESTS) {
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

  console.log("\n=== RDF 1.1 differential (native vs n3) ===");
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
      `\nRDF 1.1 differential gate FAILED: ${realGaps.length} unexplained ` +
        `disagreement(s) with n3. Fix them, or — only for intentional superset ` +
        `acceptances — add the test to supersetDivergences.`,
    );
    Deno.exit(1);
  }
  console.log(
    `\nRDF 1.1 differential gate passed: ${pass}/${rows.length} agree with n3 ` +
      `(plus ${allowlisted.length} intentional superset acceptance(s)).`,
  );
}

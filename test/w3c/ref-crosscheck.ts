import { parse as oxiParse } from "oxigraph";
// deno-lint-ignore no-import-prefix
import { Parser as N3Parser } from "npm:n3@1.26.0";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { loadRdfManifest } from "./rdf-harness.ts";
import { supersetDivergences as rdf11Allowlist } from "./rdf-differential.ts";
import { supersetDivergences as rdf12Allowlist } from "./rdf-classify.ts";

/**
 * Reference-engine cross-check for the RDF 1.1/1.2 allowlists.
 *
 * Every case in `supersetDivergences` (rdf-differential.ts, rdf11) and
 * `supersetDivergences` (rdf-classify.ts, rdf12) is a *negative* syntax test
 * that wazoo accepts on purpose: LOAD parses with a single Turtle + TriG +
 * N-Quads superset grammar and content-sniffs the format instead of trusting
 * the file extension, so Turtle/TriG constructs inside strict-format files are
 * accepted. This tool audits that policy against independent reference
 * engines and fails if any allowlisted case is *not* endorsed by at least one
 * of them:
 *
 *   - oxigraph (Rust, format-strict): verdict per declared format, plus the
 *     "superset" format a content-sniffing loader would pick for the content.
 *   - N3.js in RDF-star mode (the engine behind @comunica's rdf-parse, which
 *     passes `mediaType + "*"` to enable RDF-star syntax in every format —
 *     see @comunica/actor-rdf-parse-n3). This is the lenient, content-sniffing
 *     reference; it mirrors wazoo's design. The synchronous API is used
 *     because rdf-parse's streaming path throws an *uncaught* null-deref on
 *     some malformed RDF 1.2 inputs (nquads12-nested-bad-annotated-syntax-1)
 *     that would kill the whole tool.
 *
 * A case is endorsed when wazoo accepts it AND at least one of:
 *   1. N3 (RDF-star mode) accepts the file, or
 *   2. oxigraph accepts the file in the superset format, or
 *   3. for .nq files, oxigraph (Turtle) accepts the content with graph names
 *      stripped — the oxigraph/TriG rejection of those files is only about
 *      graph-name placement (`<g>.` after a triple), not about the construct.
 *
 * Run with:  deno task test:ref
 */

const MANIFESTS = [
  "rdf/rdf11/rdf-turtle/manifest.ttl",
  "rdf/rdf11/rdf-trig/manifest.ttl",
  "rdf/rdf11/rdf-n-triples/manifest.ttl",
  "rdf/rdf11/rdf-n-quads/manifest.ttl",
  "rdf/rdf12/rdf-turtle/syntax/manifest.ttl",
  "rdf/rdf12/rdf-trig/syntax/manifest.ttl",
  "rdf/rdf12/rdf-n-triples/syntax/manifest.ttl",
  "rdf/rdf12/rdf-n-quads/syntax/manifest.ttl",
];

const RDF11_ALLOWED = rdf11Allowlist;
const RDF12_ALLOWED = rdf12Allowlist;

function readFixture(rel: string): string {
  return Deno.readTextFileSync(`test/w3c/fixtures/${rel}`);
}

function supersetFormat(rel: string): string {
  if (rel.endsWith(".nq") || rel.endsWith(".trig")) return "application/trig";
  return "text/turtle";
}
function strictFormat(rel: string): string {
  if (rel.endsWith(".nq")) return "application/n-quads";
  if (rel.endsWith(".nt")) return "application/n-triples";
  if (rel.endsWith(".trig")) return "application/trig";
  return "text/turtle";
}

type Verdict = { kind: "accept"; quads: number } | {
  kind: "reject";
  why: string;
};

function verdictOf(run: () => unknown[]): Verdict {
  try {
    return { kind: "accept", quads: run().length };
  } catch (e) {
    return {
      kind: "reject",
      why: (e as Error).message.split("\n")[0].slice(0, 60),
    };
  }
}

function oxi(text: string, format: string, baseIRI: string): Verdict {
  return verdictOf(() => oxiParse(text, { format, base_iri: baseIRI }));
}

function n3(
  text: string,
  mediaType: string,
  baseIRI: string,
  star: boolean,
): Verdict {
  return verdictOf(() =>
    new N3Parser({ format: `${mediaType}${star ? "*" : ""}`, baseIRI } as never)
      .parse(text) as unknown[]
  );
}

/** Strip trailing N-Quads graph names (` <g>.`) so TriG can express the content. */
function stripGraphNames(text: string): string {
  return text.split("\n").map((line) =>
    line.replace(/^(.*?) <([^<>]*)> \.$/, "$1 .")
  ).join("\n");
}

interface Row {
  id: string;
  action: string;
  text: string;
  url: string;
  wazoo: Verdict;
  oxiSup: Verdict;
  oxiStrict: Verdict;
  n3Len: Verdict;
  n3Strict: Verdict;
  endorsed: boolean;
}

const rows: Row[] = [];
for (const manifest of MANIFESTS) {
  const loaded = loadRdfManifest(manifest);
  for (const c of loaded.cases) {
    const allowed = RDF11_ALLOWED.has(c.id) || RDF12_ALLOWED.has(c.id);
    if (!allowed) continue;
    const text = readFixture(c.action);
    const wazoo = verdictOf(() => parseTurtleQuads(text, c.actionUrl));
    const oxiSup = oxi(text, supersetFormat(c.action), c.actionUrl);
    const n3Len = n3(text, strictFormat(c.action), c.actionUrl, true);
    let endorsed = wazoo.kind === "accept" &&
      (n3Len.kind === "accept" || oxiSup.kind === "accept");
    if (!endorsed && c.action.endsWith(".nq")) {
      const stripped = oxi(stripGraphNames(text), "text/turtle", c.actionUrl);
      endorsed = stripped.kind === "accept";
    }
    rows.push({
      id: c.id,
      action: c.action,
      text,
      url: c.actionUrl,
      wazoo,
      oxiSup,
      oxiStrict: oxi(text, strictFormat(c.action), c.actionUrl),
      n3Len,
      n3Strict: n3(text, strictFormat(c.action), c.actionUrl, false),
      endorsed,
    });
  }
}

const fmt = (v: Verdict): string => v.kind === "accept" ? `A(${v.quads})` : `R`;

console.log(
  "case | wazoo | oxi-superset | oxi-strict | n3-lenient | n3-strict | endorsed",
);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    `${r.id} | ${fmt(r.wazoo)} | ${fmt(r.oxiSup)} | ${fmt(r.oxiStrict)} | ` +
      `${fmt(r.n3Len)} | ${fmt(r.n3Strict)} | ${r.endorsed ? "yes" : "NO"}`,
  );
}

const unendorsed = rows.filter((r) => !r.endorsed);
const n3Crashed = rows.filter((r) =>
  r.n3Len.kind === "reject" && r.n3Len.why.includes("termType")
);

console.log(`\n${rows.length} allowlisted case(s) cross-checked.`);
console.log(
  `endorsed: ${rows.length - unendorsed.length}/${rows.length} ` +
    `(N3-RDF-star or oxigraph-superset or stripped-graph oxigraph-Turtle).`,
);
if (n3Crashed.length > 0) {
  console.log(
    `note: N3's RDF-star mode crashes (null-deref) on ${n3Crashed.length} ` +
      `input(s): ${n3Crashed.map((r) => r.id).join(", ")}`,
  );
}

if (unendorsed.length > 0) {
  console.error(
    `\nCross-check FAILED: ${unendorsed.length} allowlisted case(s) are accepted ` +
      `by wazoo but rejected by every lenient reference engine. These are ` +
      `candidates for unholding — tighten the grammar or remove them from the ` +
      `allowlist:\n  ${unendorsed.map((r) => r.id).join("\n  ")}`,
  );
  Deno.exit(1);
}
console.log(
  "\nCross-check passed: every allowlisted divergence is endorsed by at least " +
    "one reference engine, so none requires unholding.",
);

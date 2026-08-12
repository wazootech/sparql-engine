import { loadManifest } from "./manifest.ts";
import type { W3cTestCase } from "./manifest.ts";
import { W3cRunner } from "./runner.ts";

/**
 * W3C_BASE_RESOLVER resolves fixture paths on disk. The fixtures live in
 * test/w3c/fixtures/sparql11/<category>/<file>.
 */
const FIXTURES_ROOT = new URL(
  "./fixtures/sparql11/",
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const CATEGORIES = [
  // Query evaluation core.
  "aggregates",
  "bind",
  "bindings",
  "cast",
  "construct",
  "exists",
  "functions",
  "grouping",
  "negation",
  "project-expression",
  "property-path",
  "subquery",
  // Update evaluation core.
  "add",
  "basic-update",
  "clear",
  "copy",
  "delete",
  "delete-data",
  "delete-insert",
  "delete-where",
  "drop",
  "move",
  "update-silent",
];

function readFixture(file: string): string {
  // Every reference (manifest, query, data, result) is relative to the
  // fixtures root; W3cTestCase file fields already carry the category prefix.
  return Deno.readTextFileSync(`${FIXTURES_ROOT}${file}`);
}

function loadAllCases(): { cases: W3cTestCase[]; skipped: number } {
  const cases: W3cTestCase[] = [];
  let skipped = 0;
  for (const category of CATEGORIES) {
    const manifestText = readFixture(`${category}/manifest.ttl`);
    const loaded = loadManifest(category, manifestText);
    cases.push(...loaded.cases);
    skipped += loaded.skipped;
  }
  return { cases, skipped };
}

function printReport(
  report: Awaited<ReturnType<W3cRunner["run"]>>,
  skipped: number,
): void {
  console.log("=== W3C SPARQL 1.1 differential runner ===");
  console.log(`total:      ${report.total}`);
  console.log(`pass:       ${report.pass}`);
  console.log(`gap:        ${report.gap}`);
  console.log(`error:      ${report.error}`);
  console.log(`allowlisted:${report.allowlisted}`);
  console.log(`skipped:    ${skipped}`);

  if (report.gapDetails.length > 0) {
    console.log("\n--- parity gaps (native disagrees with comunica) ---");
    for (const gap of report.gapDetails) {
      console.log(`\n[${gap.id}] ${gap.name}`);
      console.log(gap.detail.split("\n").map((line) => `  ${line}`).join("\n"));
    }
  }
  if (report.errorDetails.length > 0) {
    console.log("\n--- runner errors ---");
    for (const entry of report.errorDetails) {
      console.log(`\n[${entry.id}] ${entry.name}\n  ${entry.detail}`);
    }
  }
  if (report.conformance.length > 0) {
    const conforms = report.conformance.filter((c) =>
      c.native === "conforms" && c.comunica === "conforms"
    ).length;
    const nativeDeviations = report.conformance.filter((c) =>
      c.native === "deviates"
    ).length;
    const comunicaDeviations = report.conformance.filter((c) =>
      c.comunica === "deviates"
    ).length;
    console.log(
      "\n--- conformance soft-report (parseable results only) ---",
    );
    console.log(
      `checked: ${report.conformance.length} | both conform: ${conforms} | ` +
        `native deviates: ${nativeDeviations} | comunica deviates: ` +
        `${comunicaDeviations}`,
    );
    const asymmetric = report.conformance.filter((c) =>
      c.native !== c.comunica
    );
    for (const entry of asymmetric.slice(0, 10)) {
      console.log(
        `  [${entry.id}] native=${entry.native} comunica=${entry.comunica}`,
      );
    }
  }
}

const { cases, skipped } = loadAllCases();
const report = await new W3cRunner(readFixture).run(cases);
printReport(report, skipped);

if (report.gap > 0 || report.error > 0) {
  console.error(
    `\nW3C differential gate FAILED: ${report.gap} parity gap(s), ` +
      `${report.error} error(s). The parity-gap count is the tracked progress ` +
      `metric — each gap is a place native must converge with comunica.`,
  );
  Deno.exit(1);
}
console.log(
  `\nW3C differential gate passed: ${report.pass} tests agree ` +
    `(plus ${report.allowlisted} allowlisted documented divergences).`,
);

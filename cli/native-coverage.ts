// native-coverage summarizes `scriptc coverage` for the Node-API CLI entry
// (cli/main-node.ts, issue #221): statement totals plus blocker groups by
// file and code, split into "reached" (a build fails on these today) and
// "unreached" (behind a reached blocker; they surface as those clear).
//
//   deno task native:coverage           # summary table
//   deno task native:coverage --json    # raw scriptc diagnostics envelope
//
// scriptc reads cli/tsconfig.json, whose `paths` maps the `@/` imports, so
// the source needs no rewriting. The version is pinned: coverage output is
// the yardstick for the parser refactor and must not drift between steps.
import { dirname, fromFileUrl, relative, resolve } from "@std/path";

const SCRIPTC_VERSION = "0.4.5";
const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

interface DiagnosticGroup {
  code: string;
  scope: "reached" | "unreached";
  severity: string;
  count: number;
  primary?: { file: string };
}

interface DiagnosticsEnvelope {
  compilerVersion: string;
  stats: {
    statementsTotal: number;
    statementsStatic: number;
    statementsDynamic: number;
    statementsFailed: number;
    functionsSkipped: number;
    percentStatic: number;
  };
  groups: DiagnosticGroup[];
}

const isWindows = Deno.build.os === "windows";
const { stdout, stderr } = await new Deno.Command(
  isWindows ? "npx.cmd" : "npx",
  {
    args: [
      "--yes",
      `scriptc@${SCRIPTC_VERSION}`,
      "coverage",
      "cli/main-node.ts",
      "--print",
      "diagnostics",
    ],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  },
).output();
const text = new TextDecoder().decode(stdout);
if (!text.trimStart().startsWith("{")) {
  throw new Error(
    `scriptc printed no diagnostics:\n${new TextDecoder().decode(stderr)}`,
  );
}

if (Deno.args.includes("--json")) {
  console.log(text);
  Deno.exit(0);
}

const envelope = JSON.parse(text) as DiagnosticsEnvelope;

function relativeFile(group: DiagnosticGroup): string {
  return group.primary
    ? relative(REPO_ROOT, group.primary.file).replaceAll("\\", "/")
    : "(no location)";
}

function tally(
  groups: DiagnosticGroup[],
  key: (group: DiagnosticGroup) => string,
): [string, number, number][] {
  const totals = new Map<string, [number, number]>();
  for (const group of groups) {
    const entry = totals.get(key(group)) ?? [0, 0];
    entry[0] += 1;
    entry[1] += group.count;
    totals.set(key(group), entry);
  }
  return [...totals]
    .map(([name, [groupCount, siteCount]]): [string, number, number] => [
      name,
      groupCount,
      siteCount,
    ])
    .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]));
}

const { stats } = envelope;
console.log(
  `scriptc ${envelope.compilerVersion} coverage of cli/main-node.ts: ` +
    `${stats.statementsStatic}/${stats.statementsTotal} statements static ` +
    `(${stats.percentStatic}%), ${stats.statementsDynamic} in dynamic tier, ` +
    `${stats.functionsSkipped} functions signature-blocked`,
);
for (const scope of ["reached", "unreached"] as const) {
  const groups = envelope.groups.filter(
    (group) => group.scope === scope && group.severity === "error",
  );
  const sites = groups.reduce((sum, group) => sum + group.count, 0);
  console.log(`\n${scope}: ${groups.length} groups, ${sites} sites`);
  if (groups.length === 0) continue;
  console.log("\n| File | Groups | Sites |\n| --- | --- | --- |");
  for (const [file, groupCount, siteCount] of tally(groups, relativeFile)) {
    console.log(`| ${file} | ${groupCount} | ${siteCount} |`);
  }
  console.log("\n| Code | Groups | Sites |\n| --- | --- | --- |");
  for (const [code, groupCount, siteCount] of tally(groups, (g) => g.code)) {
    console.log(`| ${code} | ${groupCount} | ${siteCount} |`);
  }
}

// Bench snapshot staleness check for CI.
//
// Compares the committed bench/latency-data.json (a `--json` snapshot from
// bench/engine_bench.ts) against a fresh `--json` run piped to stdin. Only the deterministic parts of the inventory are
// compared — the (group, name, baseline) set — because timing values are
// machine-specific and legitimately differ between runs. Exits 1 when the
// snapshot is stale: benches were added, renamed, or removed without
// regenerating it.
//
// Run: deno bench --allow-all --json bench/engine_bench.ts \
//        | deno run --allow-read bench/latency-check.ts

import process from "node:process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
interface BenchEntry {
  group: string;
  name: string;
  baseline?: boolean;
}

interface LatencyData {
  version: number;
  runtime: string;
  benches: BenchEntry[];
}

/** readStdin reads all of stdin as UTF-8 text. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function inventory(data: LatencyData): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const b of data.benches) {
    map.set(`${b.group}\u0000${b.name}`, b.baseline === true);
  }
  return map;
}

const committed = JSON.parse(
  readFileSync(join(process.cwd(), "bench", "latency-data.json"), "utf8"),
) as LatencyData;
const fresh = JSON.parse(
  await readStdin(),
) as LatencyData;

const committedInv = inventory(committed);
const freshInv = inventory(fresh);

const noLongerRegistered: string[] = [];
const missingFromSnapshot: string[] = [];
const baselineMismatch: string[] = [];
for (const key of committedInv.keys()) {
  if (!freshInv.has(key)) noLongerRegistered.push(key);
  else if (freshInv.get(key) !== committedInv.get(key)) {
    baselineMismatch.push(key);
  }
}
for (const key of freshInv.keys()) {
  if (!committedInv.has(key)) missingFromSnapshot.push(key);
}

console.log(
  `committed snapshot: ${committedInv.size} benches (${committed.runtime})`,
);
console.log(`fresh run:         ${freshInv.size} benches (${fresh.runtime})`);
console.log(
  "timings are machine-specific and intentionally not compared; only the",
  "bench inventory (group/name/baseline) is checked.",
);

if (
  noLongerRegistered.length === 0 &&
  missingFromSnapshot.length === 0 &&
  baselineMismatch.length === 0
) {
  console.log("snapshot is current — bench inventory matches a fresh run.");
  process.exit(0);
}

if (missingFromSnapshot.length > 0) {
  console.log(
    `\nSTALE: ${missingFromSnapshot.length} bench(es) are registered but missing from bench/latency-data.json:`,
  );
  for (const key of missingFromSnapshot) {
    const [group, name] = key.split("\u0000");
    console.log(`  - ${name} (group: ${group})`);
  }
}
if (noLongerRegistered.length > 0) {
  console.log(
    `\nSTALE: ${noLongerRegistered.length} bench(es) in bench/latency-data.json are no longer registered:`,
  );
  for (const key of noLongerRegistered) {
    const [group, name] = key.split("\u0000");
    console.log(`  - ${name} (group: ${group})`);
  }
}
if (baselineMismatch.length > 0) {
  console.log(
    `\nSTALE: ${baselineMismatch.length} bench(es) changed baseline flag:`,
  );
  for (const key of baselineMismatch) {
    const [group, name] = key.split("\u0000");
    console.log(`  - ${name} (group: ${group})`);
  }
}
console.log(
  "\nFix: run `deno task bench:latency` (full timing run) and commit the refreshed bench/latency-data.json.",
);
process.exit(1);

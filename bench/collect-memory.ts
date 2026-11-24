// Runs the six per-engine memory probes (each in its own Deno process, so
// only the target engine is loaded) and writes the merged bench/memory-data.json
// consumed by bench/treemap.ts and the README.
//
// Run: deno run --allow-all --allow-write --allow-read bench/collect-memory.ts

import process from "node:process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess, runtimeName, scriptCommand } from "../test/run-process.ts";
const ENGINES = ["wazoo", "comunica", "oxigraph"];
const WORKLOADS = ["scan", "exists"] as const;

const engines: Record<string, Record<string, unknown>> = {};
for (const engine of ENGINES) {
  engines[engine] = {};
  for (const workload of WORKLOADS) {
    const [program, ...args] = scriptCommand(
      join(process.cwd(), "bench", "memory-probe.ts"),
      [engine, workload],
    );
    const { code, stdout, stderr } = await runProcess(program, args);
    if (code !== 0) {
      throw new Error(
        `memory probe failed for ${engine}/${workload}:\n${stderr}`,
      );
    }
    const probe = JSON.parse(stdout) as {
      runs: number;
      peak: { heapUsed: number; rss: number; external: number };
    };
    engines[engine][workload] = {
      peakHeap: probe.peak.heapUsed,
      peakRss: probe.peak.rss,
      external: probe.peak.external,
    };
    console.error(
      `${engine}/${workload}: peak heap ${
        (probe.peak.heapUsed / 1048576).toFixed(1)
      } MiB, ` +
        `rss ${(probe.peak.rss / 1048576).toFixed(1)} MiB`,
    );
  }
}

const data = {
  generatedAt: new Date().toISOString(),
  runs: 5,
  dataset: "10,000-person graph (~55,000 quads)",
  measurement:
    `isolated ${runtimeName} subprocess per engine, process.memoryUsage() peak after each run`,
  engines,
};
writeFileSync(
  join(process.cwd(), "bench", "memory-data.json"),
  JSON.stringify(data, null, 2) + "\n",
);
console.error("wrote bench/memory-data.json");

/**
 * cli-bench-measure runs the per-target measurement protocol: one timed
 * invocation per workload per round, with parsed stage timings and peak RSS
 * where `/usr/bin/time` provides it.
 */
import { join } from "@std/path";
import type { Options, Sample, SizeMeasurement } from "./cli-bench-types.ts";
import { buildPeopleTurtle, WORKLOADS } from "./cli-workloads.ts";
import { runOnce } from "./cli-bench-run.ts";
import { rotate } from "./cli-bench-stats.ts";
import { aggregateSamples } from "./cli-bench-aggregate.ts";

export async function measureSize(
  people: number,
  options: Options,
  measureRss: boolean,
): Promise<SizeMeasurement> {
  const directory = await Deno.makeTempDir({ prefix: "sparql-cli-bench-" });
  const dataPath = join(directory, "people.ttl");
  await Deno.writeTextFile(dataPath, buildPeopleTurtle(people));
  const samples: Sample[] = [];
  const peakRssKiB: Record<string, number> = {};
  try {
    // One untimed warm run per workload and target fills the OS file cache and
    // proves the targets agree, so a faster but wrong build cannot win. It also
    // absorbs a first-execution virus scan, which otherwise lands on whichever
    // binary happens to run first after a rebuild.
    for (const workload of WORKLOADS) {
      const args = workload.args(dataPath);
      let referenceOutput: string | undefined;
      for (const target of options.targets) {
        const warm = await runOnce(target.command, args, false);
        referenceOutput ??= warm.stdout;
        if (warm.stdout !== referenceOutput) {
          throw new Error(
            `${target.name} disagrees with ${
              options.targets[0].name
            } on ${workload.name}`,
          );
        }
      }
    }
    for (let round = 0; round < options.runs; round++) {
      for (const workload of WORKLOADS) {
        const args = workload.args(dataPath);
        for (const target of rotate(options.targets, round)) {
          const result = await runOnce(target.command, args, measureRss);
          samples.push({
            round,
            workload: workload.name,
            target: target.name,
            ms: result.ms,
          });
          peakRssKiB[target.name] = Math.max(
            peakRssKiB[target.name] ?? 0,
            result.peakRssKiB ?? 0,
          );
        }
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  const { raw, operations, ratios } = aggregateSamples(samples, options);

  const peakRssMiB: Record<string, number | undefined> = {};
  for (const target of options.targets) {
    peakRssMiB[target.name] = measureRss
      ? (peakRssKiB[target.name] ?? 0) / 1024
      : undefined;
  }

  return {
    people,
    triples: people * 5,
    peakRssMiB,
    raw,
    operations,
    ratios,
  };
}

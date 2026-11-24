/**
 * bench is the one shared benchmark harness for the bench scripts. It stands
 * in for `Deno.bench`, which only exists under Deno: a file registers benches
 * with `bench(definition, fn)` and ends with `await runBenches()`. mitata
 * measures each registered bench in turn, grouped as registered, with the
 * `baseline: true` row of a group as the reference for the ratio column. It
 * runs unchanged on Deno and Bun.
 *
 *   deno run -A bench/engine_bench.ts                    # table on stdout
 *   deno run -A bench/engine_bench.ts --json             # latency-data.json on stdout
 *   deno run -A bench/engine_bench.ts --filter "oxigraph"  # only matching bench names
 *   bun bench/engine_bench.ts --json                     # the same on Bun
 *
 * The `--json` document keeps the shape `deno bench --json` printed, with times
 * in nanoseconds, so bench/latency-chart.ts and bench/latency-check.ts read it
 * unchanged.
 */
import process from "node:process";
import { measure } from "mitata";

/** BenchDefinition names one bench and, optionally, how long to measure it. */
export interface BenchDefinition {
  name: string;
  /** group collects the benches compared with each other. */
  group: string;
  /** baseline marks the row the other rows of the group are compared to. */
  baseline?: boolean;
  /** warmup is how many milliseconds to run the bench before measuring. */
  warmup?: number;
  /** iterations is the exact number of measured samples (default: adaptive). */
  iterations?: number;
}

/** BenchFunction is the timed body; it may be async. */
export type BenchFunction = () => unknown;

/** BenchTimings holds one bench's statistics in nanoseconds. */
export interface BenchTimings {
  n: number;
  min: number;
  max: number;
  avg: number;
  p75: number;
  p99: number;
  p995: number;
  p999: number;
}

/** BenchResult is one measured bench. */
export interface BenchResult {
  group: string;
  name: string;
  baseline: boolean;
  timings: BenchTimings;
}

const registered: { definition: BenchDefinition; fn: BenchFunction }[] = [];

/** bench registers one bench; runBenches measures everything registered. */
export function bench(definition: BenchDefinition, fn: BenchFunction): void {
  registered.push({ definition, fn });
}

/** quantile reads the q-quantile of ascending-sorted samples. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** warmUp runs fn repeatedly for at least `milliseconds`. */
async function warmUp(fn: BenchFunction, milliseconds: number): Promise<void> {
  const deadline = performance.now() + milliseconds;
  do {
    await fn();
  } while (performance.now() < deadline);
}

async function measureOne(
  definition: BenchDefinition,
  fn: BenchFunction,
): Promise<BenchTimings> {
  if (definition.warmup) await warmUp(fn, definition.warmup);
  const exact = definition.iterations;
  // mitata's own warmup is skipped for an explicit sample count (inventory
  // mode asks for one sample, no warmup).
  const stats = await measure(
    fn,
    exact === undefined
      ? {}
      : {
          min_samples: exact,
          max_samples: exact,
          min_cpu_time: 0,
          warmup_samples: 0,
          batch_samples: 1,
        },
  );
  const sorted = [...stats.samples].sort((a, b) => a - b);
  return {
    n: stats.ticks,
    min: stats.min,
    max: stats.max,
    avg: stats.avg,
    p75: stats.p75,
    p99: stats.p99,
    p995: quantile(sorted, 0.995),
    p999: stats.p999,
  };
}

/** formatDuration prints nanoseconds in the unit a reader would pick. */
function formatDuration(nanoseconds: number): string {
  if (nanoseconds >= 1e9) return `${(nanoseconds / 1e9).toFixed(2)} s`;
  if (nanoseconds >= 1e6) return `${(nanoseconds / 1e6).toFixed(2)} ms`;
  if (nanoseconds >= 1e3) return `${(nanoseconds / 1e3).toFixed(2)} µs`;
  return `${nanoseconds.toFixed(0)} ns`;
}

/** printTable writes the human-readable report, one block per group. */
function printTable(results: BenchResult[]): void {
  const groups = [...new Set(results.map((result) => result.group))];
  for (const group of groups) {
    const rows = results.filter((result) => result.group === group);
    const baseline = rows.find((row) => row.baseline);
    console.log(`\ngroup ${group}`);
    for (const row of rows) {
      const ratio =
        baseline && baseline !== row
          ? `  ${(row.timings.avg / baseline.timings.avg).toFixed(2)}x baseline`
          : baseline === row
            ? "  (baseline)"
            : "";
      console.log(
        `  ${row.name.padEnd(40)} avg ${formatDuration(
          row.timings.avg,
        ).padStart(10)}` +
          `  p99 ${formatDuration(row.timings.p99).padStart(10)}` +
          `  n=${row.timings.n}${ratio}`,
      );
    }
  }
}

/** runtimeLabel names the running runtime, version and platform. */
function runtimeLabel(): string {
  const { bun, deno } = process.versions;
  const runtime = bun !== undefined ? `Bun/${bun}` : `Deno/${deno}`;
  return `${runtime} ${process.arch}-${process.platform}`;
}

/** toLatencyData renders results in the `deno bench --json` document shape. */
function toLatencyData(results: BenchResult[]): string {
  return JSON.stringify(
    {
      version: 1,
      runtime: runtimeLabel(),
      cpu: "unknown",
      benches: results.map((result) => ({
        group: result.group,
        name: result.name,
        baseline: result.baseline,
        results: [{ ok: result.timings }],
      })),
    },
    null,
    2,
  );
}

/** optionValue reads `--name value` from argv. */
function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/**
 * runBenches measures every registered bench in order and prints the table,
 * or the JSON document under `--json`. Progress goes to stderr so stdout
 * stays a clean report. A bench that throws fails the whole run, as a failing
 * Deno.bench did.
 */
export async function runBenches(
  argv: string[] = process.argv.slice(2),
): Promise<BenchResult[]> {
  const pattern = optionValue(argv, "--filter");
  const filter = pattern === undefined ? undefined : new RegExp(pattern);
  const results: BenchResult[] = [];
  for (const { definition, fn } of registered) {
    if (filter && !filter.test(`${definition.group} ${definition.name}`)) {
      continue;
    }
    console.error(`bench ${definition.group} / ${definition.name}`);
    results.push({
      group: definition.group,
      name: definition.name,
      baseline: definition.baseline === true,
      timings: await measureOne(definition, fn),
    });
  }
  if (argv.includes("--json")) {
    console.log(toLatencyData(results));
  } else {
    printTable(results);
  }
  return results;
}

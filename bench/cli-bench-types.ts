/**
 * cli-bench-types holds the CLI benchmark's shared data shapes: one stage of
 * an invocation, a build target, sampling options and their measurements.
 */
/** Operation separates one stage of an invocation from the stages before it. */
export interface Operation {
  /** name labels the stage in output. */
  name: string;

  /** workload is the invocation that includes the stage. */
  workload: string;

  /** subtrahend is the earlier workload to subtract, absent for cold start. */
  subtrahend?: string;
}

export interface Target {
  name: string;
  command: string[];
  binaryPath?: string;
}

export interface Options {
  targets: Target[];
  people: number[];
  runs: number;
  json: boolean;
}

export interface Sample {
  round: number;
  workload: string;
  target: string;
  ms: number;
}

/**
 * Summary is a distribution reduced to the median, the middle half and the
 * minimum. The minimum is the steadiest estimator for CPU-bound work, where
 * noise only ever adds time.
 */
export interface Summary {
  median: number;
  lowerQuartile: number;
  upperQuartile: number;
  minimum: number;
}

export interface SizeMeasurement {
  people: number;
  triples: number;
  /** peakRssMiB is keyed by target, undefined without `/usr/bin/time`. */
  peakRssMiB: Record<string, number | undefined>;
  /** raw holds the measured workload totals, keyed by target then workload. */
  raw: Record<string, Record<string, Summary>>;
  /** operations holds the paired per-round stage times, target then operation. */
  operations: Record<string, Record<string, Summary>>;
  /** ratios holds baseline/target per round, target then operation; >1 wins. */
  ratios: Record<string, Record<string, Summary>>;
}

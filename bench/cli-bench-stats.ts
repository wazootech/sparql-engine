/**
 * cli-bench-stats holds the CLI benchmark's pure statistics: quantile
 * interpolation, median/IQR summaries, least-squares fits and the report
 * formatting both the console run and any future reporter share.
 */
import type { Summary } from "./cli-bench-types.ts";

/** quantile interpolates the fraction-th quantile of sorted values. */
export function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

/** summarize reduces values to median and interquartile range. */
export function summarize(values: number[]): Summary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: quantile(sorted, 0.5),
    lowerQuartile: quantile(sorted, 0.25),
    upperQuartile: quantile(sorted, 0.75),
    minimum: sorted[0],
  };
}

/**
 * NOISY_SPREAD_FRACTION is the interquartile range, as a fraction of the
 * median, above which a cell is flagged as too noisy to trust.
 */
export const NOISY_SPREAD_FRACTION = 0.1;

/**
 * isNoisy reports whether a summary's interquartile range exceeds
 * NOISY_SPREAD_FRACTION of its median. A non-positive or non-finite median
 * (a stage smaller than the drift removed by subtraction) is always noisy.
 */
export function isNoisy(summary: Summary): boolean {
  if (!Number.isFinite(summary.median) || summary.median <= 0) return true;
  return (summary.upperQuartile - summary.lowerQuartile) / summary.median >
    NOISY_SPREAD_FRACTION;
}

/** linearFit returns the least-squares slope and intercept of points. */
export function linearFit(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const count = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / count;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  const slope = variance === 0 ? 0 : covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * formatSummary renders "median (lower–upper) min N", with a trailing "⚠" when
 * the spread is wide enough that the median should not be trusted.
 */
export function formatSummary(summary: Summary): string {
  const text = `${summary.median.toFixed(1)} (${
    summary.lowerQuartile.toFixed(0)
  }–${summary.upperQuartile.toFixed(0)}) min ${summary.minimum.toFixed(1)}`;
  return isNoisy(summary) ? `${text} ⚠` : text;
}

export function formatRatio(summary: Summary): string {
  if (!Number.isFinite(summary.median)) return "n/a (below drift)";
  return summary.median >= 1
    ? `${summary.median.toFixed(2)}x faster`
    : `${(1 / summary.median).toFixed(2)}x slower`;
}

/** sampleKey identifies one timed invocation. */
export function sampleKey(
  round: number,
  workload: string,
  target: string,
): string {
  return `${round}\u0000${workload}\u0000${target}`;
}

/** rotate returns values shifted by offset, wrapping around. */
export function rotate<T>(values: T[], offset: number): T[] {
  const shift = offset % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

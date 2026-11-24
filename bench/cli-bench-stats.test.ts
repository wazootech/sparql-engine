import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSummary, isNoisy, summarize } from "./cli-bench-stats.ts";

test("summarize reports the minimum alongside the quartiles", () => {
  const summary = summarize([30, 10, 20, 50, 40]);
  assert.deepStrictEqual(summary.minimum, 10);
  assert.deepStrictEqual(summary.median, 30);
  assert.deepStrictEqual(summary.lowerQuartile, 20);
  assert.deepStrictEqual(summary.upperQuartile, 40);
});

test("isNoisy flags a spread above ten percent of the median", () => {
  assert.deepStrictEqual(isNoisy(summarize([100, 101, 102, 103, 104])), false);
  assert.deepStrictEqual(isNoisy(summarize([100, 130, 160, 190, 220])), true);
});

test("isNoisy flags a stage at or below zero or not finite", () => {
  assert.deepStrictEqual(isNoisy(summarize([-5, -3, -1])), true);
  assert.deepStrictEqual(
    isNoisy({
      median: Number.NaN,
      lowerQuartile: Number.NaN,
      upperQuartile: Number.NaN,
      minimum: Number.NaN,
    }),
    true,
  );
});

test("formatSummary appends the minimum and the noise marker", () => {
  assert.deepStrictEqual(
    formatSummary(summarize([100, 101, 102, 103, 104])),
    "102.0 (101–103) min 100.0",
  );
  assert.deepStrictEqual(
    formatSummary(summarize([100, 130, 160, 190, 220])).endsWith(" ⚠"),
    true,
  );
});

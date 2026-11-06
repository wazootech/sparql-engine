import { assertEquals } from "@std/assert";
import { formatSummary, isNoisy, summarize } from "./cli-bench-stats.ts";

Deno.test("summarize reports the minimum alongside the quartiles", () => {
  const summary = summarize([30, 10, 20, 50, 40]);
  assertEquals(summary.minimum, 10);
  assertEquals(summary.median, 30);
  assertEquals(summary.lowerQuartile, 20);
  assertEquals(summary.upperQuartile, 40);
});

Deno.test("isNoisy flags a spread above ten percent of the median", () => {
  assertEquals(isNoisy(summarize([100, 101, 102, 103, 104])), false);
  assertEquals(isNoisy(summarize([100, 130, 160, 190, 220])), true);
});

Deno.test("isNoisy flags a stage at or below zero or not finite", () => {
  assertEquals(isNoisy(summarize([-5, -3, -1])), true);
  assertEquals(
    isNoisy({
      median: Number.NaN,
      lowerQuartile: Number.NaN,
      upperQuartile: Number.NaN,
      minimum: Number.NaN,
    }),
    true,
  );
});

Deno.test("formatSummary appends the minimum and the noise marker", () => {
  assertEquals(
    formatSummary(summarize([100, 101, 102, 103, 104])),
    "102.0 (101–103) min 100.0",
  );
  assertEquals(
    formatSummary(summarize([100, 130, 160, 190, 220])).endsWith(" ⚠"),
    true,
  );
});

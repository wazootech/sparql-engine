import assert from "node:assert/strict";
import { test } from "node:test";
import {
  divideExactDecimal,
  formatExactDecimal,
  parseExactDecimal,
} from "@/evaluator/exact-decimal.ts";

const render = (text: string): string | null => {
  const parsed = parseExactDecimal(text);
  return parsed === null ? null : formatExactDecimal(parsed);
};

test("parseExactDecimal reads every decimal spelling", () => {
  const spellings: [string, string][] = [
    ["12.34", "12.34"],
    [" \t12.5\n", "12.5"],
    ["-12.50", "-12.5"],
    ["+007", "7"],
    [".25", "0.25"],
    ["25.", "25"],
    ["1.5e2", "150"],
    ["15E-1", "1.5"],
    ["1e+12", "1000000000000"],
  ];
  for (const [text, expected] of spellings) {
    assert.strictEqual(render(text), expected, text);
  }
});

test("parseExactDecimal rejects what is not a decimal", () => {
  for (const text of ["", " ", ".", "+", "e5", "1e", "0x10", "1.2.3", "INF"]) {
    assert.strictEqual(parseExactDecimal(text), null, text);
  }
});

test("parseExactDecimal expands exponents only up to its bound", () => {
  assert.ok(parseExactDecimal("1e400") !== null);
  assert.ok(parseExactDecimal("1e-400") !== null);
  assert.strictEqual(parseExactDecimal("1e401"), null);
  assert.strictEqual(parseExactDecimal("1e-401"), null);
});

test("divideExactDecimal is exact while the quotient terminates", () => {
  const one = { significand: 1n, scale: 0 };
  // 1 / 2^20 needs exactly twenty extra digits.
  assert.strictEqual(
    divideExactDecimal(one, 1_048_576),
    "0.00000095367431640625",
  );
  assert.strictEqual(divideExactDecimal(one, 3), String(1 / 3));
});

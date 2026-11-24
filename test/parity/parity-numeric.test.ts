import {
  normalizeDecimalLexicalForm,
  normalizeNumericTerm,
} from "./parity-canonical.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const XSD = "http://www.w3.org/2001/XMLSchema#";

test("normalizeDecimalLexicalForm drops trailing zeros and the empty fraction", () => {
  const cases: Array<[string, string]> = [
    ["3.0", "3"],
    ["2.50", "2.5"],
    ["-2.0", "-2"],
    ["-0.0", "0"],
    ["0.0", "0"],
    ["+1.0", "1"],
    ["007.10", "7.1"],
    [".5", "0.5"],
    ["5.", "5"],
    ["1.25", "1.25"],
    ["not a number", "not a number"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeDecimalLexicalForm(input), expected, input);
  }
});

test("normalizeNumericTerm rewrites decimals, floats and doubles by value only", () => {
  const literal = (datatype: string, value: string) => ({
    termType: "Literal" as const,
    value,
    datatype: `${XSD}${datatype}`,
  });
  assert.equal(normalizeNumericTerm(literal("decimal", "3.0")).value, "3");
  assert.equal(normalizeNumericTerm(literal("float", "1.0E0")).value, "1");
  assert.equal(normalizeNumericTerm(literal("double", "1.5E1")).value, "15");
  assert.equal(normalizeNumericTerm(literal("double", "INF")).value, "INF");
  assert.equal(normalizeNumericTerm(literal("integer", "007")).value, "007");
  assert.equal(
    normalizeNumericTerm({ termType: "NamedNode", value: "http://x/" }).value,
    "http://x/",
  );
});

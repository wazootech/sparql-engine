import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeBlankNodeLabel,
  escapeIri,
  escapeLiteral,
} from "@/serialize/turtle-escape.ts";

test("escapeIri writes every forbidden character as a UCHAR", () => {
  const forbidden = '\\><"{}|^` \u0001';
  for (const character of forbidden) {
    const hex = character.codePointAt(0)!.toString(16).padStart(4, "0");
    assert.strictEqual(escapeIri(character), `\\u${hex}`);
  }
});

test("escapeLiteral escapes control characters", () => {
  assert.strictEqual(escapeLiteral("\r\t\u001f"), "\\r\\t\\u001f");
});

test("escapeBlankNodeLabel hex-encodes unsafe characters", () => {
  assert.strictEqual(escapeBlankNodeLabel("a \u0001:"), "a_x20__x01__x3A_");
});

test("escapeBlankNodeLabel hex-encodes a leading or trailing dot or dash", () => {
  assert.strictEqual(escapeBlankNodeLabel(".b"), "_x2E_b");
  assert.strictEqual(escapeBlankNodeLabel("-b"), "_x2D_b");
  assert.strictEqual(escapeBlankNodeLabel("b."), "b_x2E_");
  assert.strictEqual(escapeBlankNodeLabel("."), "_x2E_");
});

test("escapeBlankNodeLabel keeps the characters the grammar allows", () => {
  for (const label of ["a.b", "b-", "_a", "0a", "é中😀", "à‿"]) {
    assert.strictEqual(escapeBlankNodeLabel(label), label);
  }
});

test("escapeBlankNodeLabel encodes characters outside the grammar", () => {
  assert.strictEqual(escapeBlankNodeLabel("a×"), "a_xD7_");
  assert.strictEqual(escapeBlankNodeLabel("a;"), "a_x37E_");
  assert.strictEqual(escapeBlankNodeLabel("a　"), "a_x3000_");
  assert.strictEqual(escapeBlankNodeLabel("̀a"), "_x300_a");
  assert.strictEqual(escapeBlankNodeLabel("‿a"), "_x203F_a");
});

test("escapeBlankNodeLabel never writes two dots in a row", () => {
  assert.strictEqual(escapeBlankNodeLabel("a..b"), "a._x2E_b");
  assert.strictEqual(escapeBlankNodeLabel("a...b"), "a._x2E_.b");
});

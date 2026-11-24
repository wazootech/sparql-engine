import {
  bindValue,
  emptyEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("WazooSparqlEngine - STRBEFORE/STRAFTER preserve language and empty when absent", async () => {
  const engine = emptyEngine();
  const before = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRBEFORE("abc"@en, "b") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(before, { type: "literal", value: "a", lang: "en" });
  const after = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRAFTER("abc", "z") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(after, { type: "literal", value: "" });
});

test("WazooSparqlEngine - LANG and LANGMATCHES", async () => {
  const engine = emptyEngine();
  const lang = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc"@en) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(lang, { type: "literal", value: "en" });
  const plain = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(plain, { type: "literal", value: "" });
  const iri = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG(<http://x>) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(iri, null);
  const wildcard = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANGMATCHES("", "*") AS ?v) }`,
    "v",
  );
  // "*" matches any non-empty tag; the empty LANG() of a plain literal never
  // matches (SPARQL 1.1 §17.4.3, langMatches), so this is false.
  assert.deepStrictEqual(wildcard, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
  const tagged = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANGMATCHES("en-US", "*") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(tagged, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
});

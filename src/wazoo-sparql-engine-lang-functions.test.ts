import {
  bindValue,
  emptyEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals } from "@std/assert";

Deno.test("WazooSparqlEngine - STRBEFORE/STRAFTER preserve language and empty when absent", async () => {
  const engine = emptyEngine();
  const before = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRBEFORE("abc"@en, "b") AS ?v) }`,
    "v",
  );
  assertEquals(before, { type: "literal", value: "a", lang: "en" });
  const after = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRAFTER("abc", "z") AS ?v) }`,
    "v",
  );
  assertEquals(after, { type: "literal", value: "" });
});

Deno.test("WazooSparqlEngine - LANG and LANGMATCHES", async () => {
  const engine = emptyEngine();
  const lang = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc"@en) AS ?v) }`,
    "v",
  );
  assertEquals(lang, { type: "literal", value: "en" });
  const plain = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc") AS ?v) }`,
    "v",
  );
  assertEquals(plain, { type: "literal", value: "" });
  const iri = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG(<http://x>) AS ?v) }`,
    "v",
  );
  assertEquals(iri, null);
  const wildcard = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANGMATCHES("", "*") AS ?v) }`,
    "v",
  );
  assertEquals(wildcard, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
});

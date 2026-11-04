import {
  bindValue,
  emptyEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals } from "@std/assert";

Deno.test("WazooSparqlEngine - RDF 1.2 directional literal functions", async () => {
  const engine = emptyEngine();
  const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

  // LANGDIR returns the base direction; empty when absent; non-literals error.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "ltr" },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc"@en) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "" },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "" },
  );
  assertEquals(
    await bindValue(
      engine,
      "SELECT ?v WHERE { BIND(LANGDIR(<http://x>) AS ?v) }",
      "v",
    ),
    null,
  );

  // hasLang / hasLangDir are unary term tests.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );

  // hasLang(langString, language) — language tag match (case-insensitive).
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en, "en") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en, "EN") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en, "fr") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  // A literal without a language tag never matches, even with a matching
  // second argument.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc", "en") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );

  // hasLang(simpleLiteral, language, direction) — tag and direction match;
  // the direction argument is canonicalized to lowercase.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en--ltr, "en", "ltr") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en--ltr, "en", "LTR") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en--ltr, "en", "rtl") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  // A lang-tagged literal without a base direction fails the 3-arity form.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en, "en", "ltr") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLangDir("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLangDir("abc"@en) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );

  // STRLANGDIR builds an rdf:dirLangString literal; bad args are errors.
  const built = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "en", "ltr") AS ?v) }',
    "v",
  );
  assertEquals(built, { type: "literal", value: "abc", lang: "en" });
  const builtDatatype = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(STRLANGDIR("abc", "ar", "rtl")) AS ?v) }',
    "v",
  );
  assertEquals(builtDatatype, {
    type: "uri",
    value: `${RDF}dirLangString`,
  });
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "en", "LTR") AS ?v) }',
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "", "ltr") AS ?v) }',
      "v",
    ),
    null,
  );

  // STRLANG rejects an empty tag; STRDT rejects the rdf:langString and
  // rdf:dirLangString datatypes.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANG("abc", "") AS ?v) }',
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(STRDT("abc", <${RDF}langString>) AS ?v) }`,
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(STRDT("abc", <${RDF}dirLangString>) AS ?v) }`,
      "v",
    ),
    null,
  );

  // Literal equality in filters includes the direction.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr = "x"@en--ltr AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en = "x"@en--ltr AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr = "x"@en--rtl AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr != "x"@en--rtl AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );

  // String functions preserve the direction.
  const ucaseDir = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(UCASE("abc"@en--ltr)) AS ?v) }',
    "v",
  );
  assertEquals(ucaseDir, { type: "uri", value: `${RDF}dirLangString` });
  const concatDir = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(CONCAT("a"@en--ltr, "b"@en--ltr)) AS ?v) }',
    "v",
  );
  assertEquals(concatDir, { type: "uri", value: `${RDF}dirLangString` });
  const concatMixed = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(CONCAT("a"@en--ltr, "b"@en)) AS ?v) }',
    "v",
  );
  assertEquals(concatMixed, { type: "uri", value: `${XSD}string` });

  // LANGMATCHES over a directional literal: LANG strips the direction.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGMATCHES(LANG("x"@en--ltr), "en") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGMATCHES(LANG("x"@en--ltr), "fr") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
});

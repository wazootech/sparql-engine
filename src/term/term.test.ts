import assert from "node:assert/strict";
import { test } from "node:test";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/public.ts";
import {
  canonicalDouble,
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  compareNumericValues,
  formatNumber,
  numericValue,
  rdfTermToSparqlValue,
  sameRdfTerm,
  termKey,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_INTEGER,
} from "@/term/mod.ts";

const { namedNode, blankNode, literal, quad } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const xsdInteger = namedNode(XSD_INTEGER);

test("termKey agrees with sameRdfTerm on term identity", () => {
  const terms: rdfjs.Term[] = [
    ex("a"),
    ex("a"),
    ex("b"),
    blankNode("x"),
    blankNode("x"),
    literal("plain"),
    literal("plain"),
    literal("hello", "en"),
    literal("hello", "fr"),
    literal("hello", { language: "en", direction: "ltr" }),
    literal("hello", { language: "en", direction: "rtl" }),
    literal("hello", { language: "ar", direction: "rtl" }),
    literal("42", xsdInteger),
    literal("42"),
    quad(ex("s"), ex("p"), literal("o")),
    quad(ex("s"), ex("p"), literal("o")),
    quad(ex("s"), ex("p"), literal("other")),
    quad(quad(ex("s1"), ex("p1"), ex("o1")), ex("p"), literal("nested")),
    literal("a|b"),
    literal("a", "b"),
    literal("a\\|b"),
    literal("a\\b"),
    namedNode("http://x/a|b"),
    blankNode("a|b"),
    literal("a", namedNode("http://x/|")),
    quad(ex("s"), ex("p"), literal("a|b")),
    quad(ex("s"), ex("p"), literal("a", "b")),
    quad(namedNode("a"), namedNode("x|uri:y"), namedNode("z")),
    quad(namedNode("a"), namedNode("x"), namedNode("y|uri:z")),
  ];
  for (let i = 0; i < terms.length; i++) {
    for (let j = 0; j < terms.length; j++) {
      assert.deepStrictEqual(
        termKey(terms[i]) === termKey(terms[j]),
        sameRdfTerm(terms[i], terms[j]),
        `termKey/sameRdfTerm disagreement at ${i}/${j}`,
      );
    }
  }
});

test("termKey escapes delimiters so term values can never collide", () => {
  // Regression: `"a|b"` (plain literal) and `"a"` with language `b` both
  // used to render `literal:a|b||` and collide onto the same key.
  const pipeInValue = literal("a|b");
  const pipeAsLang = literal("a", "b");
  assert.notDeepStrictEqual(termKey(pipeInValue), termKey(pipeAsLang));

  // Backslash is escaped before pipe so a literal backslash + pipe cannot
  // mimic an escaped pipe.
  const backslashThenPipe = literal("a\\|b");
  const plainBackslash = literal("a\\b");
  assert.notDeepStrictEqual(
    termKey(backslashThenPipe),
    termKey(plainBackslash),
  );
  assert.notDeepStrictEqual(
    termKey(backslashThenPipe),
    termKey(literal("a|b")),
  );

  // Delimiters in non-literal term values and datatype URIs stay distinct.
  assert.notDeepStrictEqual(
    termKey(namedNode("http://x/a|b")),
    termKey(namedNode("http://x/a")),
  );
  assert.notDeepStrictEqual(termKey(blankNode("a|b")), termKey(blankNode("a")));
  assert.notDeepStrictEqual(
    termKey(literal("a", namedNode("http://x/|"))),
    termKey(literal("a", namedNode("http://x/"))),
  );

  // RDF-star nesting composes safely.
  assert.notDeepStrictEqual(
    termKey(quad(ex("s"), ex("p"), literal("a|b"))),
    termKey(quad(ex("s"), ex("p"), literal("a", "b"))),
  );

  // Pre-fix, these two distinct RDF-star terms rendered the identical key
  // because `|` inside a term value could be read as a field separator:
  //   quad(namedNode("a"), namedNode("x|uri:y"), namedNode("z"))
  //   quad(namedNode("a"), namedNode("x"), namedNode("y|uri:z"))
  // both encoded to `quad:uri:a|uri:x|uri:y|uri:z`.
  assert.notDeepStrictEqual(
    termKey(quad(namedNode("a"), namedNode("x|uri:y"), namedNode("z"))),
    termKey(quad(namedNode("a"), namedNode("x"), namedNode("y|uri:z"))),
  );
});

test("canonicalize agrees across the RDF/JS and SparqlValue representations", () => {
  const terms: rdfjs.Term[] = [
    ex("a"),
    blankNode("x"),
    literal("plain"),
    literal("hello", "en"),
    literal("hello", { language: "en", direction: "ltr" }),
    literal("hello", { language: "ar", direction: "rtl" }),
    literal("42", xsdInteger),
    quad(ex("s"), ex("p"), literal("o")),
    quad(
      ex("s"),
      ex("p"),
      literal("hello", { language: "en", direction: "ltr" }),
    ),
    quad(ex("s"), ex("p"), quad(ex("s1"), ex("p1"), ex("o1"))),
  ];
  for (const term of terms) {
    const fromTerm = canonicalizeRdfTerm(term);
    const fromValue = canonicalizeSparqlValue(rdfTermToSparqlValue(term));
    assert.deepStrictEqual(
      fromValue,
      fromTerm,
      `canonical mismatch for ${term.termType}`,
    );
  }
});

test("canonicalize projects xsd:string and RDF-star terms structurally", () => {
  const plain = canonicalizeRdfTerm(literal("plain"));
  assert.deepStrictEqual(plain.datatype, undefined, "xsd:string is implicit");
  assert.deepStrictEqual(plain.language, undefined);

  const lang = canonicalizeRdfTerm(literal("hello", "en"));
  assert.deepStrictEqual(lang.language, "en");

  const nested = canonicalizeRdfTerm(
    quad(ex("s"), ex("p"), quad(ex("s1"), ex("p1"), ex("o1"))),
  );
  assert.deepStrictEqual(nested.termType, "Quad");
  assert.deepStrictEqual(nested.value, "");
  assert.deepStrictEqual(nested.subject, {
    termType: "NamedNode",
    value: "http://example.org/s",
  });
  assert.deepStrictEqual(nested.object?.termType, "Quad");
});

test("numericValue parses integers with BigInt and other numerics with Number", () => {
  assert.deepStrictEqual(numericValue(literal("42", xsdInteger)), 42n);
  assert.deepStrictEqual(
    numericValue(literal("9007199254740993", xsdInteger)),
    9007199254740993n,
  );
  assert.deepStrictEqual(
    numericValue(literal("3.5", namedNode(XSD_DECIMAL))),
    3.5,
  );
  assert.deepStrictEqual(numericValue(literal("plain")), null);
  assert.deepStrictEqual(
    numericValue(literal("not-a-number", xsdInteger)),
    null,
  );
  assert.deepStrictEqual(numericValue(literal("hello", "en")), null);
});

test("compareNumericValues orders BigInts exactly and Numbers numerically", () => {
  assert.deepStrictEqual(compareNumericValues(2n, 10n), -1);
  assert.deepStrictEqual(compareNumericValues(10n, 2n), 1);
  assert.deepStrictEqual(compareNumericValues(5n, 5n), 0);
  assert.deepStrictEqual(compareNumericValues(2, 10), -1);
  assert.deepStrictEqual(compareNumericValues(10, 2), 1);
  assert.deepStrictEqual(compareNumericValues(2n, 10), -1);
});

test("formatNumber keeps Comunica's plain decimal forms", () => {
  assert.deepStrictEqual(formatNumber(3, XSD_DECIMAL), "3");
  assert.deepStrictEqual(formatNumber(3.5, XSD_DECIMAL), "3.5");
  assert.deepStrictEqual(formatNumber(1e21, XSD_DOUBLE), "1e+21");
  assert.deepStrictEqual(canonicalDouble(3), "3.0E0");
  assert.deepStrictEqual(canonicalDouble(1.5), "1.5E0");
  assert.deepStrictEqual(canonicalDouble(0), "0.0E0");
});
test("literal lowercases BCP47 language tags per the RDF/JS contract", () => {
  assert.deepStrictEqual(literal("foo", "en-US").language, "en-us");
  assert.deepStrictEqual(literal("foo", "EN-us").language, "en-us");
  assert.deepStrictEqual(literal("foo", "en").language, "en");
  assert.deepStrictEqual(literal("foo", "en-GB").language, "en-gb");
  assert.deepStrictEqual(literal("plain").language, "");
});

test("fromTerm preserves the language of lang-tagged literals", () => {
  const original = literal("foo", "en-US");
  const roundTripped = DataFactory.fromTerm(original);
  assert.deepStrictEqual(roundTripped.value, "foo");
  assert.deepStrictEqual(roundTripped.language, "en-us");
  assert.deepStrictEqual(
    roundTripped.datatype.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
  );
});

test("directional literals carry rdf:dirLangString and survive fromTerm", () => {
  const RDF_DIR_LANG_STRING =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
  const RDF_LANG_STRING =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
  const lit = literal("foo", { language: "en", direction: "ltr" });
  assert.deepStrictEqual(lit.language, "en");
  assert.deepStrictEqual(lit.direction, "ltr");
  assert.deepStrictEqual(lit.datatype.value, RDF_DIR_LANG_STRING);
  // A directional language without a direction is a plain rdf:langString.
  assert.deepStrictEqual(
    literal("foo", { language: "en" }).datatype.value,
    RDF_LANG_STRING,
  );
  assert.deepStrictEqual(
    literal("foo", { language: "en", direction: "" }).datatype.value,
    RDF_LANG_STRING,
  );
  const roundTripped = DataFactory.fromTerm(lit);
  assert.deepStrictEqual(roundTripped.direction, "ltr");
  assert.deepStrictEqual(roundTripped.datatype.value, RDF_DIR_LANG_STRING);
});

test("term identity and canonicalization distinguish directions", () => {
  const RDF_DIR_LANG_STRING =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
  const ltr = literal("foo", { language: "en", direction: "ltr" });
  const rtl = literal("foo", { language: "en", direction: "rtl" });
  const plain = literal("foo", "en");
  assert.notDeepStrictEqual(sameRdfTerm(ltr, rtl), true);
  assert.notDeepStrictEqual(sameRdfTerm(ltr, plain), true);
  assert.notDeepStrictEqual(termKey(ltr), termKey(rtl));
  assert.notDeepStrictEqual(termKey(ltr), termKey(plain));
  assert.notDeepStrictEqual(
    JSON.stringify(canonicalizeRdfTerm(ltr)),
    JSON.stringify(canonicalizeRdfTerm(rtl)),
  );
  // Same direction + language + datatype canonicalize identically.
  assert.deepStrictEqual(
    JSON.stringify(canonicalizeRdfTerm(ltr)),
    JSON.stringify(canonicalizeRdfTerm(DataFactory.fromTerm(ltr))),
  );
  assert.deepStrictEqual(
    JSON.stringify(canonicalizeRdfTerm(ltr)).includes(RDF_DIR_LANG_STRING),
    false,
  );
});

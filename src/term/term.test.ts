import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
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

Deno.test("termKey agrees with sameRdfTerm on term identity", () => {
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
    literal("42", xsdInteger),
    literal("42"),
    quad(ex("s"), ex("p"), literal("o")),
    quad(ex("s"), ex("p"), literal("o")),
    quad(ex("s"), ex("p"), literal("other")),
    quad(quad(ex("s1"), ex("p1"), ex("o1")), ex("p"), literal("nested")),
  ];
  for (let i = 0; i < terms.length; i++) {
    for (let j = 0; j < terms.length; j++) {
      assertEquals(
        termKey(terms[i]) === termKey(terms[j]),
        sameRdfTerm(terms[i], terms[j]),
        `termKey/sameRdfTerm disagreement at ${i}/${j}`,
      );
    }
  }
});

Deno.test("canonicalize agrees across the RDF/JS and SparqlValue representations", () => {
  const terms: rdfjs.Term[] = [
    ex("a"),
    blankNode("x"),
    literal("plain"),
    literal("hello", "en"),
    literal("42", xsdInteger),
    quad(ex("s"), ex("p"), literal("o")),
    quad(ex("s"), ex("p"), quad(ex("s1"), ex("p1"), ex("o1"))),
  ];
  for (const term of terms) {
    const fromTerm = canonicalizeRdfTerm(term);
    const fromValue = canonicalizeSparqlValue(rdfTermToSparqlValue(term));
    assertEquals(
      fromValue,
      fromTerm,
      `canonical mismatch for ${term.termType}`,
    );
  }
});

Deno.test("canonicalize projects xsd:string and RDF-star terms structurally", () => {
  const plain = canonicalizeRdfTerm(literal("plain"));
  assertEquals(plain.datatype, undefined, "xsd:string is implicit");
  assertEquals(plain.language, undefined);

  const lang = canonicalizeRdfTerm(literal("hello", "en"));
  assertEquals(lang.language, "en");

  const nested = canonicalizeRdfTerm(
    quad(ex("s"), ex("p"), quad(ex("s1"), ex("p1"), ex("o1"))),
  );
  assertEquals(nested.termType, "Quad");
  assertEquals(nested.value, "");
  assertEquals(nested.subject, {
    termType: "NamedNode",
    value: "http://example.org/s",
  });
  assertEquals(nested.object?.termType, "Quad");
});

Deno.test("numericValue parses integers with BigInt and other numerics with Number", () => {
  assertEquals(numericValue(literal("42", xsdInteger)), 42n);
  assertEquals(
    numericValue(literal("9007199254740993", xsdInteger)),
    9007199254740993n,
  );
  assertEquals(numericValue(literal("3.5", namedNode(XSD_DECIMAL))), 3.5);
  assertEquals(numericValue(literal("plain")), null);
  assertEquals(numericValue(literal("not-a-number", xsdInteger)), null);
  assertEquals(numericValue(literal("hello", "en")), null);
});

Deno.test("compareNumericValues orders BigInts exactly and Numbers numerically", () => {
  assertEquals(compareNumericValues(2n, 10n), -1);
  assertEquals(compareNumericValues(10n, 2n), 1);
  assertEquals(compareNumericValues(5n, 5n), 0);
  assertEquals(compareNumericValues(2, 10), -1);
  assertEquals(compareNumericValues(10, 2), 1);
  assertEquals(compareNumericValues(2n, 10), -1);
});

Deno.test("formatNumber keeps Comunica's plain decimal forms", () => {
  assertEquals(formatNumber(3, XSD_DECIMAL), "3");
  assertEquals(formatNumber(3.5, XSD_DECIMAL), "3.5");
  assertEquals(formatNumber(1e21, XSD_DOUBLE), "1e+21");
  assertEquals(canonicalDouble(3), "3.0E0");
  assertEquals(canonicalDouble(1.5), "1.5E0");
  assertEquals(canonicalDouble(0), "0.0E0");
});

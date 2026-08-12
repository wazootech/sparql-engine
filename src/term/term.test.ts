import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "n3";
import type { SparqlValue } from "@/sparql-engine-interface.ts";
import {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  rdfTermToSparqlValue,
  sameRdfTerm,
  sameSparqlValue,
  sparqlValueKey,
  sparqlValueToRdfTerm,
  termKey,
} from "@/term/mod.ts";

const { namedNode, blankNode, literal, quad } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");

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

Deno.test("sparqlValueKey agrees with sameSparqlValue on value identity", () => {
  const values: SparqlValue[] = [
    { type: "uri", value: "http://example.org/a" },
    { type: "uri", value: "http://example.org/a" },
    { type: "bnode", value: "x" },
    { type: "literal", value: "plain" },
    { type: "literal", value: "plain" },
    { type: "literal", value: "hello", "xml:lang": "en" },
    { type: "literal", value: "hello", "xml:lang": "fr" },
    {
      type: "literal",
      value: "42",
      datatype: "http://www.w3.org/2001/XMLSchema#integer",
    },
    { type: "literal", value: "42" },
    {
      type: "triple",
      value: {
        subject: { type: "uri", value: "http://example.org/s" },
        predicate: { type: "uri", value: "http://example.org/p" },
        object: { type: "literal", value: "o" },
      },
    },
    {
      type: "triple",
      value: {
        subject: { type: "uri", value: "http://example.org/s" },
        predicate: { type: "uri", value: "http://example.org/p" },
        object: { type: "literal", value: "o" },
      },
    },
  ];
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      assertEquals(
        sparqlValueKey(values[i]) === sparqlValueKey(values[j]),
        sameSparqlValue(values[i], values[j]),
        `sparqlValueKey/sameSparqlValue disagreement at ${i}/${j}`,
      );
    }
  }
});

Deno.test("rdfTermToSparqlValue / sparqlValueToRdfTerm round-trips", () => {
  const terms: rdfjs.Term[] = [
    ex("a"),
    blankNode("x"),
    literal("plain"),
    literal("hello", "en"),
    literal("42", xsdInteger),
    quad(ex("s"), ex("p"), literal("o")),
  ];
  for (const term of terms) {
    const converted = sparqlValueToRdfTerm(rdfTermToSparqlValue(term));
    assertEquals(
      sameRdfTerm(term, converted),
      true,
      `round-trip lost identity for ${term.termType}`,
    );
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

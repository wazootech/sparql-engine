import { assertEquals, assertThrows } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { serializeTurtle } from "@/serialize/turtle-writer.ts";
import { quadSetsIsomorphicAsSets } from "../../test/w3c/rdf-harness.ts";

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);

/** roundTrip asserts that parsing the serialization reproduces the quads. */
function roundTrip(
  quads: rdfjs.Quad[],
  options?: Parameters<typeof serializeTurtle>[1],
) {
  const text = serializeTurtle(quads, options);
  const reparsed = parseTurtleQuads(text);
  assertEquals(
    quadSetsIsomorphicAsSets(reparsed, quads),
    true,
    `round-trip failed for:\n${text}`,
  );
  return text;
}

Deno.test("turtle-writer: basic Turtle round-trip groups by subject/predicate", () => {
  const quads = [
    quad(ex("s"), ex("p"), literal("hello", "en")),
    quad(ex("s"), ex("p"), ex("o2")),
    quad(
      ex("s"),
      ex("q"),
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
    quad(ex("t"), ex("p"), blankNode("b1")),
    quad(blankNode("b1"), ex("name"), literal("Bob")),
  ];
  const text = roundTrip(quads);
  // Comma (object list) and semicolon (predicate list) shorthand is used.
  assertEquals(text.includes(", "), true);
  assertEquals(text.includes(";\n"), true);
});

Deno.test("turtle-writer: typed, language, and plain literals serialize distinctly", () => {
  const quads = [
    quad(ex("s"), ex("p"), literal("plain")),
    quad(ex("s"), ex("p"), literal("deutsch", "de")),
    quad(
      ex("s"),
      ex("p"),
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  ];
  const text = roundTrip(quads);
  assertEquals(text.includes('"plain"'), true);
  assertEquals(text.includes('"deutsch"@de'), true);
  assertEquals(
    text.includes('"42"^^<http://www.w3.org/2001/XMLSchema#integer>'),
    true,
  );
});

Deno.test("turtle-writer: RDF 1.2 triple terms round-trip", () => {
  const quads = [
    quad(ex("s"), ex("p"), quad(ex("a"), ex("b"), ex("c"))),
  ];
  roundTrip(quads);
});

Deno.test("turtle-writer: directional language literals round-trip", () => {
  const quads = [
    quad(
      ex("s"),
      ex("p"),
      literal("مرحبا", { language: "ar", direction: "rtl" }),
    ),
  ];
  const text = roundTrip(quads);
  assertEquals(text.includes('"مرحبا"@ar--rtl'), true);
});

Deno.test("turtle-writer: named graphs emit TriG blocks and round-trip", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o"), defaultGraph()),
    quad(ex("s2"), ex("p2"), ex("o2"), ex("g")),
    quad(ex("s3"), ex("p3"), ex("o3"), ex("g")),
  ];
  const text = roundTrip(quads);
  assertEquals(text.includes("<http://example.org/g> {"), true);
});

Deno.test("turtle-writer: N-Quads round-trips graph labels", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o"), defaultGraph()),
    quad(ex("s"), ex("p"), literal("x"), ex("g")),
  ];
  const text = roundTrip(quads, { format: "n-quads" });
  assertEquals(
    text,
    "<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n" +
      '<http://example.org/s> <http://example.org/p> "x" <http://example.org/g> .\n',
  );
});

Deno.test("turtle-writer: N-Triples round-trips and rejects named graphs", () => {
  const quads = [
    quad(ex("s"), ex("p"), literal("v")),
  ];
  const text = roundTrip(quads, { format: "n-triples" });
  assertEquals(
    text,
    '<http://example.org/s> <http://example.org/p> "v" .\n',
  );
  assertThrows(
    () =>
      serializeTurtle([quad(ex("s"), ex("p"), ex("o"), ex("g"))], {
        format: "n-triples",
      }),
    Error,
    "named graph",
  );
});

Deno.test("turtle-writer: literal escaping survives a round-trip", () => {
  const quads = [
    quad(
      ex("s"),
      ex("p"),
      literal('quote " backslash \\ newline \n tab \t control \u0001', "en"),
    ),
  ];
  const text = roundTrip(quads);
  assertEquals(text.includes("\\u0001"), true);
  assertEquals(text.includes("\\n"), true);
});

Deno.test("turtle-writer: unicode IRIs round-trip as raw UTF-8", () => {
  const quads = [
    quad(namedNode("http://example.org/ünïcode/路径"), ex("p"), ex("o")),
  ];
  roundTrip(quads);
});

Deno.test("turtle-writer: forbidden IRI characters are UCHAR-escaped", () => {
  // The RDF spec forbids `<>"{}|^`\\` and control chars in IRIs entirely, so
  // the parser rejects them even escaped — the writer emits the UCHAR form
  // and the caller is responsible for supplying spec-legal IRIs.
  const text = serializeTurtle([
    quad(namedNode('http://example.org/a>b"c'), ex("p"), ex("o")),
  ]);
  assertEquals(text.includes("<http://example.org/a\\u003eb\\u0022c>"), true);
});

Deno.test("turtle-writer: prefixes compact IRIs and round-trip", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o")),
    quad(namedNode("http://other.example/x"), ex("p"), ex("o")),
  ];
  const text = roundTrip(quads, { prefixes: { ex: "http://example.org/" } });
  assertEquals(text.includes("@prefix ex: <http://example.org/> ."), true);
  assertEquals(text.includes("ex:s ex:p ex:o"), true);
  assertEquals(text.includes("<http://other.example/x>"), true);
});

Deno.test("turtle-writer: empty input produces an empty document", () => {
  assertEquals(serializeTurtle([]), "");
  assertEquals(serializeTurtle([], { format: "n-quads" }), "");
});

Deno.test("turtle-writer: default graph term in a term position is rejected", () => {
  assertThrows(
    () => serializeTurtle([quad(ex("s"), ex("p"), defaultGraph())]),
    Error,
    "Cannot serialize DefaultGraph",
  );
});

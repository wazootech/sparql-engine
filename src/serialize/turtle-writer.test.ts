import assert from "node:assert/strict";
import { test } from "node:test";
import { thrown } from "../../test/thrown.ts";
import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad } from "@/parser/rdf-terms.ts";
import { DataFactory } from "@/term/public.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { serializeTurtle } from "@/serialize/turtle-writer.ts";
import { quadSetsIsomorphicAsSets } from "../../test/w3c/rdf-harness.ts";
import { Parser as N3Parser } from "n3";

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);

/** roundTrip asserts that parsing the serialization reproduces the quads. */
function roundTrip(
  quads: rdfjs.Quad[],
  options?: Parameters<typeof serializeTurtle>[1],
) {
  const text = serializeTurtle(quads, options);
  const reparsed = parseTurtleQuads(text);
  assert.deepStrictEqual(
    quadSetsIsomorphicAsSets(reparsed, quads),
    true,
    `round-trip failed for:\n${text}`,
  );
  return text;
}

test("turtle-writer: basic Turtle round-trip groups by subject/predicate", () => {
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
  assert.deepStrictEqual(text.includes(", "), true);
  assert.deepStrictEqual(text.includes(";\n"), true);
});

test("turtle-writer: typed, language, and plain literals serialize distinctly", () => {
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
  assert.deepStrictEqual(text.includes('"plain"'), true);
  assert.deepStrictEqual(text.includes('"deutsch"@de'), true);
  assert.deepStrictEqual(
    text.includes('"42"^^<http://www.w3.org/2001/XMLSchema#integer>'),
    true,
  );
});

test("turtle-writer: RDF 1.2 triple terms round-trip", () => {
  const quads = [quad(ex("s"), ex("p"), quad(ex("a"), ex("b"), ex("c")))];
  roundTrip(quads);
});

test("turtle-writer: directional language literals round-trip", () => {
  const quads = [
    quad(
      ex("s"),
      ex("p"),
      literal("مرحبا", { language: "ar", direction: "rtl" }),
    ),
  ];
  const text = roundTrip(quads);
  assert.deepStrictEqual(text.includes('"مرحبا"@ar--rtl'), true);
});

test("turtle-writer: named graphs emit TriG blocks and round-trip", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o"), defaultGraph()),
    quad(ex("s2"), ex("p2"), ex("o2"), ex("g")),
    quad(ex("s3"), ex("p3"), ex("o3"), ex("g")),
  ];
  const text = roundTrip(quads);
  assert.deepStrictEqual(text.includes("<http://example.org/g> {"), true);
});

test("turtle-writer: N-Quads round-trips graph labels", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o"), defaultGraph()),
    quad(ex("s"), ex("p"), literal("x"), ex("g")),
  ];
  const text = roundTrip(quads, { format: "n-quads" });
  assert.deepStrictEqual(
    text,
    "<http://example.org/s> <http://example.org/p> <http://example.org/o> .\n" +
      '<http://example.org/s> <http://example.org/p> "x" <http://example.org/g> .\n',
  );
});

test("turtle-writer: N-Triples round-trips and rejects named graphs", () => {
  const quads = [quad(ex("s"), ex("p"), literal("v"))];
  const text = roundTrip(quads, { format: "n-triples" });
  assert.deepStrictEqual(
    text,
    '<http://example.org/s> <http://example.org/p> "v" .\n',
  );
  thrown(
    () =>
      serializeTurtle([quad(ex("s"), ex("p"), ex("o"), ex("g"))], {
        format: "n-triples",
      }),
    Error,
    "named graph",
  );
});

test("turtle-writer: literal escaping survives a round-trip", () => {
  const quads = [
    quad(
      ex("s"),
      ex("p"),
      literal('quote " backslash \\ newline \n tab \t control \u0001', "en"),
    ),
  ];
  const text = roundTrip(quads);
  assert.deepStrictEqual(text.includes("\\u0001"), true);
  assert.deepStrictEqual(text.includes("\\n"), true);
});

test("turtle-writer: unicode IRIs round-trip as raw UTF-8", () => {
  const quads = [
    quad(namedNode("http://example.org/ünïcode/路径"), ex("p"), ex("o")),
  ];
  roundTrip(quads);
});

test("turtle-writer: forbidden IRI characters are UCHAR-escaped", () => {
  // The RDF spec forbids `<>"{}|^`\\` and control chars in IRIs entirely, so
  // the parser rejects them even escaped — the writer emits the UCHAR form
  // and the caller is responsible for supplying spec-legal IRIs.
  const text = serializeTurtle([
    quad(namedNode('http://example.org/a>b"c'), ex("p"), ex("o")),
  ]);
  assert.deepStrictEqual(
    text.includes("<http://example.org/a\\u003eb\\u0022c>"),
    true,
  );
});

test("turtle-writer: prefixes compact IRIs and round-trip", () => {
  const quads = [
    quad(ex("s"), ex("p"), ex("o")),
    quad(namedNode("http://other.example/x"), ex("p"), ex("o")),
  ];
  const text = roundTrip(quads, { prefixes: { ex: "http://example.org/" } });
  assert.deepStrictEqual(
    text.includes("@prefix ex: <http://example.org/> ."),
    true,
  );
  assert.deepStrictEqual(text.includes("ex:s ex:p ex:o"), true);
  assert.deepStrictEqual(text.includes("<http://other.example/x>"), true);
});

test("turtle-writer: empty input produces an empty document", () => {
  assert.deepStrictEqual(serializeTurtle([]), "");
  assert.deepStrictEqual(serializeTurtle([], { format: "n-quads" }), "");
});

test("turtle-writer: default graph term in a term position is rejected", () => {
  const invalid = {
    ...quad(ex("s"), ex("p"), ex("o")),
    object: defaultGraph(),
  };
  thrown(
    () => serializeTurtle([invalid as unknown as RdfQuad]),
    Error,
    "Cannot serialize DefaultGraph",
  );
});

test("turtle-writer: a prefix is used only for a safe local name in its namespace", () => {
  const render = (
    iri: string,
    prefixes: Record<string, string> = { ex: "http://example.org/" },
  ) =>
    serializeTurtle(
      [quad(namedNode("urn:s"), namedNode("urn:p"), namedNode(iri))],
      {
        prefixes,
      },
    );
  assert.ok(render("http://example.org/ab").includes(" ex:ab ."));
  for (const iri of [
    "http://example.org/a/b",
    "http://example.org/-a",
    "http://example.org/a b",
    "http://example.org/Inc.",
    "urn:abcdefghijklmnopqrstuvwxyz",
  ]) {
    const statement = render(iri).split("\n")[1]!;
    assert.ok(!statement.includes("ex:"), iri);
  }
  const unnamed = render("http://example.org/ab", {
    "": "http://example.org/",
  });
  assert.ok(unnamed.includes("<http://example.org/ab>"));
  assert.ok(render("plain", { e: "" }).includes("<plain>"));
});

test("turtle-writer: names ending in a dot round-trip under a prefix", () => {
  const quads = [
    quad(ex("Acme_Inc."), ex("p"), ex("foo.")),
    quad(ex("s"), ex("p."), literal("v", ex("t."))),
    quad(ex("a.b"), ex("p"), ex("a-")),
  ];
  const text = roundTrip(quads, { prefixes: { ex: "http://example.org/" } });
  assert.ok(text.includes("ex:a.b ex:p ex:a- ."));
});

test("turtle-writer: awkward blank node labels stay parseable in every format", () => {
  const labels = [".b", "-b", "b.", "a×", "̀a", "a　b", "é中😀", "a..b"];
  const quads = labels.map((label, index) =>
    quad(blankNode(label), ex("p"), literal(String(index))),
  );
  for (const format of ["turtle", "n-triples", "n-quads"] as const) {
    roundTrip(quads, { format });
    const reparsed = new N3Parser().parse(serializeTurtle(quads, { format }));
    assert.strictEqual(reparsed.length, labels.length, format);
  }
});

test("turtle-writer: every format ends with a newline and splits statements by line", () => {
  const quads = [
    quad(namedNode("urn:s"), namedNode("urn:p"), literal("a")),
    quad(namedNode("urn:t"), namedNode("urn:p"), literal("b")),
  ];
  const lines = '<urn:s> <urn:p> "a" .\n<urn:t> <urn:p> "b" .\n';
  for (const format of ["turtle", "n-triples", "n-quads"] as const) {
    assert.strictEqual(serializeTurtle(quads, { format }), lines);
  }
  assert.strictEqual(serializeTurtle(quads), lines);
});

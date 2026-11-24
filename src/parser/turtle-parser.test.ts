import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import {
  ex,
  o,
  p,
  RDF_REIFIES,
  s,
} from "@/parser/turtle-parser-test-helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { thrown } from "../../test/thrown.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

function assertSameQuad(actual: rdfjs.Quad, expected: rdfjs.Quad): void {
  assert.deepStrictEqual(actual.equals(expected), true);
}
/**
 * Regression guard for the tokenizer: a stray empty alternative in the token
 * regex made exec() match the empty string without advancing lastIndex, so
 * parseTurtleQuads spun forever on any line after its last real token
 * (e.g. ":s :p :o ." never returned). These inputs used to hang.
 */
test("turtle-parser: parses multi-statement Turtle without hanging", () => {
  const quads = parseTurtleQuads(`
    @prefix : <http://example.org/> .
    @base <http://example.org/base/> .
    :s :p :o ;
       :q "hello"@en, 42 ;
       <http://example.org/r> _:b1 .
    _:b1 :name "Bob" .
  `);
  assert.deepStrictEqual(quads.length, 5);
  assertSameQuad(quads[0], quad(s, p, o, defaultGraph()));
  assertSameQuad(
    quads[1],
    quad(s, ex("q"), literal("hello", "en"), defaultGraph()),
  );
  assertSameQuad(
    quads[2],
    quad(
      s,
      ex("q"),
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      defaultGraph(),
    ),
  );
  assertSameQuad(quads[3], quad(s, ex("r"), blankNode("b1"), defaultGraph()));
  assertSameQuad(
    quads[4],
    quad(blankNode("b1"), ex("name"), literal("Bob"), defaultGraph()),
  );
});

test("turtle-parser: resolves relative IRIs against the base IRI", () => {
  const quads = parseTurtleQuads("<s> <p> <o> .", "http://example.org/doc/");
  assert.deepStrictEqual(
    quads[0].subject,
    namedNode("http://example.org/doc/s"),
  );
  assert.deepStrictEqual(
    quads[0].predicate,
    namedNode("http://example.org/doc/p"),
  );
  assert.deepStrictEqual(
    quads[0].object,
    namedNode("http://example.org/doc/o"),
  );
});

test("turtle-parser: N-Triples input", () => {
  const quads = parseTurtleQuads(
    "<http://a> <http://b> <http://c> .",
  );
  assert.deepStrictEqual(quads.length, 1);
  assertSameQuad(
    quads[0],
    quad(
      namedNode("http://a"),
      namedNode("http://b"),
      namedNode("http://c"),
      defaultGraph(),
    ),
  );
});

test("turtle-parser: keyword a and typed literals", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://example.org/> . :s a :Type ; :flag true .",
  );
  assert.deepStrictEqual(
    quads[0].predicate,
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
  );
  assert.deepStrictEqual(
    quads[1].object,
    literal("true", namedNode("http://www.w3.org/2001/XMLSchema#boolean")),
  );
});

test("turtle-parser: line comments are ignored", () => {
  const quads = parseTurtleQuads(
    "# leading comment\n<s> <p> <o> . # trailing comment",
  );
  assert.deepStrictEqual(quads.length, 1);
});

test("turtle-parser: empty anonymous blank nodes", () => {
  const quads = parseTurtleQuads("<s> <p> [] .");
  assert.deepStrictEqual(quads.length, 1);
  assert.deepStrictEqual(quads[0].object.termType, "BlankNode");
});

test("turtle-parser: RDF 1.2 triple terms in object position", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p <<( :a :b :c )>> .",
  );
  assert.deepStrictEqual(quads.length, 1);
  assert.deepStrictEqual(quads[0].object.termType, "Quad");
  const tt = quads[0].object as rdfjs.Quad;
  assert.deepStrictEqual(tt.subject.value, "http://ex/a");
  assert.deepStrictEqual(tt.predicate.value, "http://ex/b");
  assert.deepStrictEqual(tt.object.value, "http://ex/c");
});

test("turtle-parser: reified triple emits rdf:reifies with its reifier", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . << :a :b :c ~ :r >> :q :v .",
  );
  // r rdf:reifies <<( a b c )>>  and  r :q :v
  assert.deepStrictEqual(quads.length, 2);
  const reifies = quads.find((q) =>
    q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
  );
  assert.deepStrictEqual(reifies!.subject.value, "http://ex/r");
  assert.deepStrictEqual(reifies!.object.termType, "Quad");
  const qv = quads.find((q) => q.predicate.value === "http://ex/q");
  assert.deepStrictEqual(qv!.subject.value, "http://ex/r");
  assert.deepStrictEqual(qv!.object.value, "http://ex/v");
});

test("turtle-parser: annotation block reifies and annotates", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p :o {| :q :v |} .",
  );
  assert.deepStrictEqual(quads.length, 3);
  assert.deepStrictEqual(quads[0].subject.value, "http://ex/s");
  const reifies = quads[1];
  assert.deepStrictEqual(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  assert.deepStrictEqual(reifies.subject.termType, "BlankNode");
  assert.deepStrictEqual(reifies.object.termType, "Quad");
  assert.deepStrictEqual(quads[2].subject.value, reifies.subject.value);
  assert.deepStrictEqual(quads[2].predicate.value, "http://ex/q");
});

test("turtle-parser: TriG graph blocks keep their graph labels", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :g1 { :s :p :o . } GRAPH :g2 { :s2 :p :o2 . }",
  );
  assert.deepStrictEqual(quads.length, 2);
  assert.deepStrictEqual(quads[0].graph.value, "http://ex/g1");
  assert.deepStrictEqual(quads[1].graph.value, "http://ex/g2");
});

test("turtle-parser: graph block statement separators", () => {
  const prefix = "@prefix : <http://ex/> . ";
  assert.deepStrictEqual(parseTurtleQuads(prefix + ":g { }").length, 0);
  assert.deepStrictEqual(
    parseTurtleQuads(prefix + ":g { :s :p :o }").length,
    1,
  );
  assert.deepStrictEqual(
    parseTurtleQuads(prefix + ":g { :s :p :o . }").length,
    1,
  );
  const quads = parseTurtleQuads(prefix + ":g { :a :p :o . :b :p :o }");
  assert.deepStrictEqual(quads.map((quad) => quad.subject.value), [
    "http://ex/a",
    "http://ex/b",
  ]);
  assert.deepStrictEqual(quads[1].graph.value, "http://ex/g");
  thrown(() => parseTurtleQuads(prefix + ":g { :s :p :o . . }"));
  thrown(() => parseTurtleQuads(prefix + ":g { . }"));
});

// Regression for #175: a large named-graph block parsed in quadratic time
// (8,000 quads took ~19 s, versus ~0.1 s in the default graph). Compare the
// two layouts of the same statements so the bound does not depend on the
// machine's absolute speed.
test("turtle-parser: named-graph blocks parse in linear time", () => {
  const statements = Array.from(
    { length: 10_000 },
    (_, index) => `<https://ex/p${index}> <https://ex/name> "P${index}" .`,
  );
  const timeParse = (document: string) => {
    const start = performance.now();
    assert.deepStrictEqual(
      parseTurtleQuads(document).length,
      statements.length,
    );
    return performance.now() - start;
  };
  const defaultGraphDocument = statements.join("\n");
  const blockDocument = `<https://ex/g> {\n${statements.join("\n")}\n}`;
  timeParse(defaultGraphDocument); // warm up
  const defaultGraphTime = timeParse(defaultGraphDocument);
  const blockTime = timeParse(blockDocument);
  if (blockTime > 5 * defaultGraphTime + 250) {
    throw new Error(
      `named-graph block took ${blockTime.toFixed(0)} ms vs ` +
        `${defaultGraphTime.toFixed(0)} ms in the default graph`,
    );
  }
});

test("turtle-parser: N-Quads graph labels on top-level statements", () => {
  const quads = parseTurtleQuads("<s> <p> <o> <g> .");
  assert.deepStrictEqual(quads.length, 1);
  assert.deepStrictEqual(quads[0].graph.value, "g");
});

test("turtle-parser: malformed input fails loudly instead of hanging", () => {
  // A missing object can never parse; it must reject, never hang.
  thrown(() => parseTurtleQuads(":s :p ."));
  thrown(() => parseTurtleQuads("<<( :a :b"));
});

test("turtle-parser: triple term in object position keeps the outer predicate", () => {
  // Regression: the triple term's inner `verb` used to clobber the enclosing
  // statement's predicate, so `rdf:reifies <<( a b c )>>` emitted `b` as the
  // predicate instead of rdf:reifies.
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s <" + RDF_REIFIES + "> <<( :a :b :c )>> .",
  );
  assert.deepStrictEqual(quads.length, 1);
  assert.deepStrictEqual(quads[0].predicate, namedNode(RDF_REIFIES));
  assert.deepStrictEqual(quads[0].object.termType, "Quad");
});

test("turtle-parser: sibling annotation blocks each reify the base triple", () => {
  // Regression: the first block's inner object clobbered the shared tripleTerm,
  // so the second block reified `<<( reifier r1 z1 )>>` instead of `<<( s p o )>>`.
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p :o {| :r1 :z1 |} {| :r2 :z2 |} .",
  );
  assert.deepStrictEqual(quads.length, 5);
  const reifies = quads.filter((q) => q.predicate.value === RDF_REIFIES);
  assert.deepStrictEqual(reifies.length, 2);
  for (const q of reifies) {
    const tt = q.object as rdfjs.Quad;
    assert.deepStrictEqual(tt.subject.value, "http://ex/s");
    assert.deepStrictEqual(tt.predicate.value, "http://ex/p");
    assert.deepStrictEqual(tt.object.value, "http://ex/o");
  }
  assert.notDeepStrictEqual(reifies[0].subject.value, reifies[1].subject.value);
});

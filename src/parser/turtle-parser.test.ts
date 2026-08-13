import { assertEquals, assertThrows } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const s = ex("s");
const p = ex("p");
const o = ex("o");

/**
 * Regression guard for the tokenizer: a stray empty alternative in the token
 * regex made exec() match the empty string without advancing lastIndex, so
 * parseTurtleQuads spun forever on any line after its last real token
 * (e.g. ":s :p :o ." never returned). These inputs used to hang.
 */
Deno.test("turtle-parser: parses multi-statement Turtle without hanging", () => {
  const quads = parseTurtleQuads(`
    @prefix : <http://example.org/> .
    @base <http://example.org/base/> .
    :s :p :o ;
       :q "hello"@en, 42 ;
       <http://example.org/r> _:b1 .
    _:b1 :name "Bob" .
  `);
  assertEquals(quads.length, 5);
  assertEquals(quads[0], quad(s, p, o, defaultGraph()));
  assertEquals(
    quads[1],
    quad(s, ex("q"), literal("hello", "en"), defaultGraph()),
  );
  assertEquals(
    quads[2],
    quad(
      s,
      ex("q"),
      literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      defaultGraph(),
    ),
  );
  assertEquals(quads[3], quad(s, ex("r"), blankNode("b1"), defaultGraph()));
  assertEquals(
    quads[4],
    quad(blankNode("b1"), ex("name"), literal("Bob"), defaultGraph()),
  );
});

Deno.test("turtle-parser: resolves relative IRIs against the base IRI", () => {
  const quads = parseTurtleQuads("<s> <p> <o> .", "http://example.org/doc/");
  assertEquals(quads[0].subject, namedNode("http://example.org/doc/s"));
  assertEquals(quads[0].predicate, namedNode("http://example.org/doc/p"));
  assertEquals(quads[0].object, namedNode("http://example.org/doc/o"));
});

Deno.test("turtle-parser: N-Triples input", () => {
  const quads = parseTurtleQuads(
    "<http://a> <http://b> <http://c> .",
  );
  assertEquals(quads, [
    quad(
      namedNode("http://a"),
      namedNode("http://b"),
      namedNode("http://c"),
      defaultGraph(),
    ),
  ]);
});

Deno.test("turtle-parser: keyword a and typed literals", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://example.org/> . :s a :Type ; :flag true .",
  );
  assertEquals(
    quads[0].predicate,
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
  );
  assertEquals(
    quads[1].object,
    literal("true", namedNode("http://www.w3.org/2001/XMLSchema#boolean")),
  );
});

Deno.test("turtle-parser: line comments are ignored", () => {
  const quads = parseTurtleQuads(
    "# leading comment\n<s> <p> <o> . # trailing comment",
  );
  assertEquals(quads.length, 1);
});

Deno.test("turtle-parser: empty anonymous blank nodes", () => {
  const quads = parseTurtleQuads("<s> <p> [] .");
  assertEquals(quads.length, 1);
  assertEquals(quads[0].object.termType, "BlankNode");
});

Deno.test("turtle-parser: RDF 1.2 triple terms in object position", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p <<( :a :b :c )>> .",
  );
  assertEquals(quads.length, 1);
  assertEquals(quads[0].object.termType, "Quad");
  const tt = quads[0].object as rdfjs.Quad;
  assertEquals(tt.subject.value, "http://ex/a");
  assertEquals(tt.predicate.value, "http://ex/b");
  assertEquals(tt.object.value, "http://ex/c");
});

Deno.test("turtle-parser: reified triple emits rdf:reifies with its reifier", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . << :a :b :c ~ :r >> :q :v .",
  );
  // r rdf:reifies <<( a b c )>>  and  r :q :v
  assertEquals(quads.length, 2);
  const reifies = quads.find((q) =>
    q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies"
  );
  assertEquals(reifies!.subject.value, "http://ex/r");
  assertEquals(reifies!.object.termType, "Quad");
  const qv = quads.find((q) => q.predicate.value === "http://ex/q");
  assertEquals(qv!.subject.value, "http://ex/r");
  assertEquals(qv!.object.value, "http://ex/v");
});

Deno.test("turtle-parser: annotation block reifies and annotates", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p :o {| :q :v |} .",
  );
  assertEquals(quads.length, 3);
  assertEquals(quads[0].subject.value, "http://ex/s");
  const reifies = quads[1];
  assertEquals(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  assertEquals(reifies.subject.termType, "BlankNode");
  assertEquals(reifies.object.termType, "Quad");
  assertEquals(quads[2].subject.value, reifies.subject.value);
  assertEquals(quads[2].predicate.value, "http://ex/q");
});

Deno.test("turtle-parser: TriG graph blocks keep their graph labels", () => {
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :g1 { :s :p :o . } GRAPH :g2 { :s2 :p :o2 . }",
  );
  assertEquals(quads.length, 2);
  assertEquals(quads[0].graph.value, "http://ex/g1");
  assertEquals(quads[1].graph.value, "http://ex/g2");
});

Deno.test("turtle-parser: N-Quads graph labels on top-level statements", () => {
  const quads = parseTurtleQuads("<s> <p> <o> <g> .");
  assertEquals(quads.length, 1);
  assertEquals(quads[0].graph.value, "g");
});

Deno.test("turtle-parser: malformed input fails loudly instead of hanging", () => {
  // A missing object can never parse; it must reject, never hang.
  assertThrows(() => parseTurtleQuads(":s :p ."));
  assertThrows(() => parseTurtleQuads("<<( :a :b"));
});

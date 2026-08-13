import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { quadSetsIsomorphicAsSets } from "../../test/w3c/rdf-harness.ts";

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

const RDF_REIFIES = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

Deno.test("turtle-parser: triple term in object position keeps the outer predicate", () => {
  // Regression: the triple term's inner `verb` used to clobber the enclosing
  // statement's predicate, so `rdf:reifies <<( a b c )>>` emitted `b` as the
  // predicate instead of rdf:reifies.
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s <" + RDF_REIFIES + "> <<( :a :b :c )>> .",
  );
  assertEquals(quads.length, 1);
  assertEquals(quads[0].predicate, namedNode(RDF_REIFIES));
  assertEquals(quads[0].object.termType, "Quad");
});

Deno.test("turtle-parser: sibling annotation blocks each reify the base triple", () => {
  // Regression: the first block's inner object clobbered the shared tripleTerm,
  // so the second block reified `<<( reifier r1 z1 )>>` instead of `<<( s p o )>>`.
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p :o {| :r1 :z1 |} {| :r2 :z2 |} .",
  );
  assertEquals(quads.length, 5);
  const reifies = quads.filter((q) => q.predicate.value === RDF_REIFIES);
  assertEquals(reifies.length, 2);
  for (const q of reifies) {
    const tt = q.object as rdfjs.Quad;
    assertEquals(tt.subject.value, "http://ex/s");
    assertEquals(tt.predicate.value, "http://ex/p");
    assertEquals(tt.object.value, "http://ex/o");
  }
  assertNotEquals(reifies[0].subject.value, reifies[1].subject.value);
});

Deno.test("turtle-parser: reified triple inside an annotation block gets its own reifier", () => {
  // Regression: the nested reified triple reused the annotation block's
  // reifier, dropping the nested reifier's rdf:reifies triple and emitting
  // `reifier :r reifier`.
  const quads = parseTurtleQuads(
    "@prefix : <http://ex/> . :s :p :o {| :r << :s1 :p1 :o1 >> |} .",
  );
  assertEquals(quads.length, 4);
  const reifies = quads.filter((q) => q.predicate.value === RDF_REIFIES);
  assertEquals(reifies.length, 2);
  const nested = reifies.find((q) =>
    (q.object as rdfjs.Quad).subject.value === "http://ex/s1"
  );
  assertNotEquals(nested, undefined);
  assertEquals((nested!.object as rdfjs.Quad).predicate.value, "http://ex/p1");
});

Deno.test("turtle-parser: directional literals match the N-Triples reference form", () => {
  // Mirrors the RDF 1.2 eval harness (no upstream eval test exercises
  // --ltr/--rtl): the Turtle action and its N-Triples reference must parse
  // to isomorphic quad sets, with the direction kept distinct from both the
  // plain language tag and the opposite direction.
  const action = parseTurtleQuads(
    `@prefix : <http://ex/> .
     :a :label "Hello"@en--ltr, "Hello"@en--rtl, "World"@en, "Bonjour"@fr .`,
  );
  const reference = parseTurtleQuads(
    `<http://ex/a> <http://ex/label> "Hello"@en--ltr .
     <http://ex/a> <http://ex/label> "Hello"@en--rtl .
     <http://ex/a> <http://ex/label> "World"@en .
     <http://ex/a> <http://ex/label> "Bonjour"@fr .`,
  );
  assertEquals(quadSetsIsomorphicAsSets(action, reference), true);
  assertEquals(action.length, 4);
});

Deno.test("turtle-parser: RFC 3986 IRI resolution edge cases", () => {
  const base = "http://a/bb/ccc/d;p?q";
  const objectOf = (ref: string): string => {
    const quads = parseTurtleQuads(`<urn:x:s> <urn:x:p> <${ref}> .`, base);
    return quads[0].object.value;
  };
  // Network-path reference with an empty path: RFC 3986 §5.3 recomposes to
  // `http://g` (WHATWG URL normalization would add a trailing slash).
  assertEquals(objectOf("//g"), "http://g");
  assertEquals(objectOf("//g/"), "http://g/");
  assertEquals(objectOf("//g?y"), "http://g?y");
  // Dot-segment removal (RFC 3986 §5.2.4).
  assertEquals(objectOf("g/../h"), "http://a/bb/ccc/h");
  assertEquals(objectOf("g/./h"), "http://a/bb/ccc/g/h");
  assertEquals(objectOf("../../../g"), "http://a/g");
  // Same-document and query/fragment references (§5.2.2).
  assertEquals(objectOf(""), "http://a/bb/ccc/d;p?q");
  assertEquals(objectOf("?y"), "http://a/bb/ccc/d;p?y");
  assertEquals(objectOf("#s"), "http://a/bb/ccc/d;p?q#s");
});

Deno.test("turtle-parser: rejects rdf:langString and rdf:dirLangString as explicit datatypes", () => {
  const langString = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
  const dirLangString =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
  for (const dt of [langString, dirLangString]) {
    assertThrows(
      () => parseTurtleQuads(`<http://a> <http://b> "hello"^^<${dt}> .`),
      Error,
      "explicit datatype",
    );
  }
  // Prefixed spellings resolve to the same forbidden IRIs.
  assertThrows(
    () =>
      parseTurtleQuads(
        `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . ` +
          `<http://a> <http://b> "hello"^^rdf:langString .`,
      ),
    Error,
    "explicit datatype",
  );
});

Deno.test("turtle-parser: rejects BCP47-ill-formed language tags", () => {
  // 13-letter primary subtag exceeds BCP47's 5*8ALPHA maximum.
  assertThrows(
    () => parseTurtleQuads(`<http://a> <http://b> "hello"@cantbethislong .`),
    Error,
    "BCP47",
  );
  // A bare private-use singleton without any subtags is not well-formed.
  assertThrows(
    () => parseTurtleQuads(`<http://a> <http://b> "hello"@x .`),
    Error,
    "BCP47",
  );
});

Deno.test("turtle-parser: accepts well-formed language tags", () => {
  const RDF_LANG_STRING =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
  const RDF_DIR_LANG_STRING =
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
  const cases: Array<[string, string, string, string]> = [
    // [input tag, language, direction, datatype]
    ["en", "en", "", RDF_LANG_STRING],
    ["en-us", "en-us", "", RDF_LANG_STRING],
    ["zh-Hant-CN", "zh-hant-cn", "", RDF_LANG_STRING],
    ["en--ltr", "en", "ltr", RDF_DIR_LANG_STRING],
    ["en--rtl", "en", "rtl", RDF_DIR_LANG_STRING],
    ["x-foo", "x-foo", "", RDF_LANG_STRING],
  ];
  for (const [tag, language, direction, datatype] of cases) {
    const quads = parseTurtleQuads(
      `<http://a> <http://b> "hello"@${tag} .`,
    );
    const lit = quads[0].object as rdfjs.Literal;
    assertEquals(lit.language, language);
    assertEquals(lit.direction, direction);
    assertEquals(lit.datatype.value, datatype);
  }
});

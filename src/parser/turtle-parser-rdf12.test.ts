import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import {
  ex,
  o,
  p,
  RDF_REIFIES,
  s,
} from "@/parser/turtle-parser-test-helpers.ts";
import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { quadSetsIsomorphicAsSets } from "../../test/w3c/rdf-harness.ts";

const { namedNode, literal, quad, blankNode, defaultGraph } = DataFactory;

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

/**
 * #210: a blank-node property list nested inside another must not replace the
 * outer list's node. The expected graphs are the W3C Turtle suite's
 * `nested_blankNodePropertyLists` and `blankNodePropertyList_containing_collection`
 * shapes, plus the SHACL complex-path case that surfaced the bug.
 */
Deno.test("turtle-parser: nested blank-node property list in object position (#210)", () => {
  const quads = parseTurtleQuads(
    `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <http://example.org/> .
ex:S sh:property [ sh:path [ sh:inversePath ex:knows ] ; sh:minCount 1 ] .`,
  );
  const sh = (local: string) =>
    namedNode(`http://www.w3.org/ns/shacl#${local}`);
  const outer = blankNode("outer");
  const inner = blankNode("inner");
  const one = literal(
    "1",
    namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  assertEquals(
    quadSetsIsomorphicAsSets(quads, [
      quad(ex("S"), sh("property"), outer, defaultGraph()),
      quad(outer, sh("path"), inner, defaultGraph()),
      quad(inner, sh("inversePath"), ex("knows"), defaultGraph()),
      quad(outer, sh("minCount"), one, defaultGraph()),
    ]),
    true,
  );
});

Deno.test("turtle-parser: nested blank-node property lists as subject (#210)", () => {
  // W3C Turtle: nested_blankNodePropertyLists.ttl
  const quads = parseTurtleQuads(
    `[ <http://a.example/p1> [ <http://a.example/p2> <http://a.example/o2> ] ;
  <http://a.example/p> <http://a.example/o> ].`,
  );
  const b0 = blankNode("b0");
  const b1 = blankNode("b1");
  const a = (local: string) => namedNode(`http://a.example/${local}`);
  assertEquals(
    quadSetsIsomorphicAsSets(quads, [
      quad(b0, a("p1"), b1, defaultGraph()),
      quad(b1, a("p2"), a("o2"), defaultGraph()),
      quad(b0, a("p"), a("o"), defaultGraph()),
    ]),
    true,
  );
});

Deno.test("turtle-parser: collections and blank-node property lists nest (#210)", () => {
  const rdf = (local: string) =>
    namedNode(`http://www.w3.org/1999/02/22-rdf-syntax-ns#${local}`);
  // W3C Turtle: blankNodePropertyList_containing_collection.ttl
  const containing = parseTurtleQuads(
    `[ <http://a.example/p1> (1) ] .`,
  );
  const b0 = blankNode("b0");
  const l0 = blankNode("l0");
  const one = literal(
    "1",
    namedNode("http://www.w3.org/2001/XMLSchema#integer"),
  );
  assertEquals(
    quadSetsIsomorphicAsSets(containing, [
      quad(b0, namedNode("http://a.example/p1"), l0, defaultGraph()),
      quad(l0, rdf("first"), one, defaultGraph()),
      quad(l0, rdf("rest"), rdf("nil"), defaultGraph()),
    ]),
    true,
  );

  // A collection whose member is a nested list: the member is the outer node.
  const members = parseTurtleQuads(
    `<http://example.org/s> <http://example.org/p> ( [ <http://example.org/q> [ <http://example.org/r> <http://example.org/o> ] ] ) .`,
  );
  const outer = blankNode("outer");
  const inner = blankNode("inner");
  assertEquals(
    quadSetsIsomorphicAsSets(members, [
      quad(s, p, l0, defaultGraph()),
      quad(l0, rdf("first"), outer, defaultGraph()),
      quad(l0, rdf("rest"), rdf("nil"), defaultGraph()),
      quad(outer, ex("q"), inner, defaultGraph()),
      quad(inner, ex("r"), o, defaultGraph()),
    ]),
    true,
  );
});

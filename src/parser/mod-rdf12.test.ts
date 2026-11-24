import { Parser } from "./mod.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { thrown } from "../../test/thrown.ts";
import { parseBgpTriples } from "@/parser/mod-test-helpers.ts";

test("parser: unknown bare function names still rejected", () => {
  thrown(() =>
    new Parser().parse('SELECT ?x WHERE { BIND(foo("hello") AS ?x) }'),
  );
});

test("parser: AST is a drop-in for upstream sparqljs", () => {
  const ast = new Parser().parse(
    "PREFIX ex: <http://ex/> SELECT ?s ?o WHERE { ?s ex:p ?o } ORDER BY ?o LIMIT 3",
  );
  assert.deepStrictEqual(ast.type, "query");
  if (ast.type !== "query") throw new Error("expected a query");
  assert.deepStrictEqual(ast.queryType, "SELECT");
  const where = ast.where as Array<{ type: string; triples: unknown[] }>;
  assert.deepStrictEqual(where[0].type, "bgp");
  assert.deepStrictEqual(where[0].triples.length, 1);
});

test("parser: reifier and annotation after an object expand to reifies + annotation triples", () => {
  const triples = parseBgpTriples("SELECT * { ?s ?p ?o ~ :iri {| :r ?Z |} . }");
  assert.deepStrictEqual(triples.length, 3);
  const [base, reifies, ann] = triples;
  assert.deepStrictEqual(base.subject.value, "s");
  assert.deepStrictEqual(base.object.value, "o");
  assert.deepStrictEqual(reifies.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  assert.deepStrictEqual(reifies.object.termType, "Quad");
  assert.deepStrictEqual(ann.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(ann.predicate.value, "http://example.com/ns#r");
  assert.deepStrictEqual(ann.object.value, "Z");
});

test("parser: reifier-only object (no annotation block)", () => {
  const triples = parseBgpTriples("SELECT * { ?s ?p ?o ~ :iri . }");
  assert.deepStrictEqual(triples.length, 2);
  const [, reifies] = triples;
  assert.deepStrictEqual(reifies.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

test("parser: bare ~ and variable reifier bind via rdf:reifies", () => {
  const bare = parseBgpTriples("SELECT * { ?s ?p ?o ~ . }");
  // The quad stands in for the reifier; the evaluator mints a fresh one.
  assert.deepStrictEqual(bare[1].subject.termType, "Quad");
  assert.deepStrictEqual(
    bare[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );

  const variable = parseBgpTriples("SELECT * { ?s ?p ?o ~ ?r . }");
  assert.deepStrictEqual(variable[1].subject.value, "r");
  assert.deepStrictEqual(
    variable[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

test("parser: annotation block and reifier combine in either order", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o {| :a :b |} ~ :iri {| :c :d |} . }",
  );
  // base + reifies + annotation :a :b + annotation :c :d
  assert.deepStrictEqual(triples.length, 4);
  const [, reifies, annA, annC] = triples;
  assert.deepStrictEqual(reifies.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(annA.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(annA.predicate.value, "http://example.com/ns#a");
  assert.deepStrictEqual(annC.predicate.value, "http://example.com/ns#c");
});

test("parser: reifier after a quoted-triple object", () => {
  const triples = parseBgpTriples(
    "SELECT * { :s :p <<:a :b :c>> ~ :iri {| ?q ?z |} }",
  );
  assert.deepStrictEqual(triples.length, 3);
  const [base, reifies, ann] = triples;
  assert.deepStrictEqual(base.object.termType, "Quad");
  assert.deepStrictEqual(reifies.subject.value, "http://example.com/ns#iri");
  assert.deepStrictEqual(ann.subject.value, "http://example.com/ns#iri");
});

test("parser: subject-position annotation blocks are rejected per the SPARQL 1.2 grammar", () => {
  // Annotations attach to objects (Object ::= GraphNode Annotation); a quoted
  // triple subject takes a plain property list (ReifiedTripleBlock).
  thrown(() =>
    new Parser({
      sparqlStar: true,
      prefixes: { "": "http://example.com/ns#" },
    }).parse("SELECT * { << :s :p :o >> {| :a :b |} }"),
  );
  new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse("SELECT * { << :s :p :o >> :p2 :o2 }");
});

test("parser: CONSTRUCT and INSERT templates accept reifiers", () => {
  const construct = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse("CONSTRUCT { ?s ?p ?o ~ :iri {| :source ?g |} } WHERE { ?s ?p ?o }");
  assert.deepStrictEqual(construct.type, "query");
  const insert = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse("INSERT DATA { :s :p :o ~ :iri {| :a :b |} }");
  assert.deepStrictEqual(insert.type, "update");
});

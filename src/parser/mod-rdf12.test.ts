import { Parser } from "./mod.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { parseBgpTriples } from "@/parser/mod-test-helpers.ts";

Deno.test("parser: unknown bare function names still rejected", () => {
  assertThrows(() =>
    new Parser().parse('SELECT ?x WHERE { BIND(foo("hello") AS ?x) }')
  );
});

Deno.test("parser: AST is a drop-in for upstream sparqljs", () => {
  const ast = new Parser().parse(
    "PREFIX ex: <http://ex/> SELECT ?s ?o WHERE { ?s ex:p ?o } ORDER BY ?o LIMIT 3",
  );
  assertEquals(ast.type, "query");
  if (ast.type !== "query") throw new Error("expected a query");
  assertEquals(ast.queryType, "SELECT");
  const where = ast.where as Array<{ type: string; triples: unknown[] }>;
  assertEquals(where[0].type, "bgp");
  assertEquals(where[0].triples.length, 1);
});

Deno.test("parser: reifier and annotation after an object expand to reifies + annotation triples", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o ~ :iri {| :r ?Z |} . }",
  );
  assertEquals(triples.length, 3);
  const [base, reifies, ann] = triples;
  assertEquals(base.subject.value, "s");
  assertEquals(base.object.value, "o");
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  assertEquals(reifies.object.termType, "Quad");
  assertEquals(ann.subject.value, "http://example.com/ns#iri");
  assertEquals(ann.predicate.value, "http://example.com/ns#r");
  assertEquals(ann.object.value, "Z");
});

Deno.test("parser: reifier-only object (no annotation block)", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o ~ :iri . }",
  );
  assertEquals(triples.length, 2);
  const [, reifies] = triples;
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

Deno.test("parser: bare ~ and variable reifier bind via rdf:reifies", () => {
  const bare = parseBgpTriples("SELECT * { ?s ?p ?o ~ . }");
  // The quad stands in for the reifier; the evaluator mints a fresh one.
  assertEquals(bare[1].subject.termType, "Quad");
  assertEquals(
    bare[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );

  const variable = parseBgpTriples("SELECT * { ?s ?p ?o ~ ?r . }");
  assertEquals(variable[1].subject.value, "r");
  assertEquals(
    variable[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

Deno.test("parser: annotation block and reifier combine in either order", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o {| :a :b |} ~ :iri {| :c :d |} . }",
  );
  // base + reifies + annotation :a :b + annotation :c :d
  assertEquals(triples.length, 4);
  const [, reifies, annA, annC] = triples;
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(annA.subject.value, "http://example.com/ns#iri");
  assertEquals(annA.predicate.value, "http://example.com/ns#a");
  assertEquals(annC.predicate.value, "http://example.com/ns#c");
});

Deno.test("parser: reifier after a quoted-triple object", () => {
  const triples = parseBgpTriples(
    "SELECT * { :s :p <<:a :b :c>> ~ :iri {| ?q ?z |} }",
  );
  assertEquals(triples.length, 3);
  const [base, reifies, ann] = triples;
  assertEquals(base.object.termType, "Quad");
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(ann.subject.value, "http://example.com/ns#iri");
});

Deno.test("parser: subject-position annotation blocks are rejected per the SPARQL 1.2 grammar", () => {
  // Annotations attach to objects (Object ::= GraphNode Annotation); a quoted
  // triple subject takes a plain property list (ReifiedTripleBlock).
  assertThrows(() =>
    new Parser({ sparqlStar: true, prefixes: { "": "http://example.com/ns#" } })
      .parse(
        "SELECT * { << :s :p :o >> {| :a :b |} }",
      )
  );
  new Parser({ sparqlStar: true, prefixes: { "": "http://example.com/ns#" } })
    .parse(
      "SELECT * { << :s :p :o >> :p2 :o2 }",
    );
});

Deno.test("parser: CONSTRUCT and INSERT templates accept reifiers", () => {
  const construct = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(
    "CONSTRUCT { ?s ?p ?o ~ :iri {| :source ?g |} } WHERE { ?s ?p ?o }",
  );
  assertEquals(construct.type, "query");
  const insert = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(
    "INSERT DATA { :s :p :o ~ :iri {| :a :b |} }",
  );
  assertEquals(insert.type, "update");
});

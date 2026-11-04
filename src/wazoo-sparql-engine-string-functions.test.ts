import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  aggregateEngine,
  aggregateRows,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals, assertRejects } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

Deno.test("WazooSparqlEngine - UCASE and LCASE preserve language tags", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/carol"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Carol", "en"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: "SELECT ?person (UCASE(?name) AS ?upper) (LCASE(?name) AS ?lower) " +
      "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const byPerson = new Map(
      result.data.results.bindings.map((b) => [b.person.value, b]),
    );
    const alice = byPerson.get("http://example.org/alice");
    assertEquals(alice?.upper, { type: "literal", value: "ETHAN" });
    assertEquals(alice?.lower, { type: "literal", value: "ethan" });
    const carol = byPerson.get("http://example.org/carol");
    assertEquals(carol?.upper, {
      type: "literal",
      value: "CAROL",
      "xml:lang": "en",
    });
  }
});

Deno.test("WazooSparqlEngine - SUBSTR clips positions before 1 and handles length", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query:
      "SELECT (SUBSTR(?name, 2, 3) AS ?mid) (SUBSTR(?name, 0, 2) AS ?clipped) " +
      "(SUBSTR(?name, 2, 0) AS ?empty) " +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const b = result.data.results.bindings[0];
    assertEquals(b.mid.value, "tha");
    assertEquals(b.clipped.value, "E");
    assertEquals(b.empty.value, "");
  }
});

Deno.test("WazooSparqlEngine - CONCAT type error leaves the projection unbound", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("28", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: 'SELECT (CONCAT(?age, "!") AS ?c) ' +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/age> ?age }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const b = result.data.results.bindings[0];
    assertEquals("c" in b, false);
  }
});

Deno.test("WazooSparqlEngine - XSD value constructors produce canonical forms", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: 'SELECT (xsd:integer("42") AS ?i) (xsd:double("5") AS ?d) ' +
      "(xsd:boolean(1) AS ?b) (xsd:decimal(3.5) AS ?dec) " +
      "(xsd:integer(28) AS ?fromNum) (xsd:double(true) AS ?fromBool) " +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  const xsd = "http://www.w3.org/2001/XMLSchema#";
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const b = result.data.results.bindings[0];
    assertEquals(b.i, {
      type: "literal",
      value: "42",
      datatype: `${xsd}integer`,
    });
    assertEquals(b.d, {
      type: "literal",
      value: "5.0E0",
      datatype: `${xsd}double`,
    });
    assertEquals(b.b, {
      type: "literal",
      value: "true",
      datatype: `${xsd}boolean`,
    });
    assertEquals(b.dec, {
      type: "literal",
      value: "3.5",
      datatype: `${xsd}decimal`,
    });
    assertEquals(b.fromNum, {
      type: "literal",
      value: "28",
      datatype: `${xsd}integer`,
    });
    assertEquals(b.fromBool, {
      type: "literal",
      value: "1.0E0",
      datatype: `${xsd}double`,
    });
  }
});

Deno.test("WazooSparqlEngine - STRDT and STRLANG re-tag literals", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: 'SELECT (STRDT("x", <http://example.org/t>) AS ?t) ' +
      '(STRLANG("hello", "en") AS ?sl) ' +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const b = result.data.results.bindings[0];
    assertEquals(b.t, {
      type: "literal",
      value: "x",
      datatype: "http://example.org/t",
    });
    assertEquals(b.sl, {
      type: "literal",
      value: "hello",
      "xml:lang": "en",
    });
  }
});

Deno.test("WazooSparqlEngine - unknown function call raises a clear error", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  await assertRejects(
    () =>
      engine.execute({
        query: "SELECT (<http://example.org/custom>(?name) AS ?c) " +
          "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
      }),
    Error,
    "Unsupported SPARQL expression: functionCall",
  );
});

Deno.test("WazooSparqlEngine - GROUP BY partitions and COUNT/SUM/AVG aggregate per group", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT ?s (COUNT(?o) AS ?c) (SUM(?o) AS ?su) (AVG(?o) AS ?a) " +
        "WHERE { ?s <http://example.org/p> ?o } GROUP BY ?s ORDER BY ?s",
    ),
    [
      '{"s":"http://example.org/a","c":"3^^http://www.w3.org/2001/XMLSchema#integer","su":"6^^http://www.w3.org/2001/XMLSchema#integer","a":"2^^http://www.w3.org/2001/XMLSchema#decimal"}',
      '{"s":"http://example.org/b","c":"2^^http://www.w3.org/2001/XMLSchema#integer","su":"6^^http://www.w3.org/2001/XMLSchema#integer","a":"3^^http://www.w3.org/2001/XMLSchema#decimal"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - aggregates without GROUP BY treat the whole result as one group", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT (COUNT(*) AS ?c) (MIN(?o) AS ?mn) (MAX(?o) AS ?mx) " +
        "WHERE { ?s <http://example.org/p> ?o }",
    ),
    [
      '{"c":"5^^http://www.w3.org/2001/XMLSchema#integer","mn":"1^^http://www.w3.org/2001/XMLSchema#integer","mx":"4^^http://www.w3.org/2001/XMLSchema#integer"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - COUNT(DISTINCT) and SUM(DISTINCT) deduplicate", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT (COUNT(DISTINCT ?o) AS ?c) (SUM(DISTINCT ?o) AS ?su) " +
        "WHERE { ?s <http://example.org/p> ?o }",
    ),
    [
      '{"c":"4^^http://www.w3.org/2001/XMLSchema#integer","su":"10^^http://www.w3.org/2001/XMLSchema#integer"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - HAVING filters groups by aggregate value", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s <http://example.org/p> ?o } " +
        "GROUP BY ?s HAVING (COUNT(?o) > 2) ORDER BY ?s",
    ),
    [
      '{"s":"http://example.org/a","c":"3^^http://www.w3.org/2001/XMLSchema#integer"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - empty aggregate set: COUNT/SUM/AVG zero, MIN/MAX/SAMPLE unbound, GC empty", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT (COUNT(?o) AS ?c) (SUM(?o) AS ?su) (AVG(?o) AS ?a) " +
        "(MIN(?o) AS ?mn) (SAMPLE(?o) AS ?sp) (GROUP_CONCAT(?o) AS ?gc) " +
        "WHERE { ?s <http://example.org/none> ?o }",
    ),
    [
      '{"c":"0^^http://www.w3.org/2001/XMLSchema#integer","su":"0^^http://www.w3.org/2001/XMLSchema#integer","a":"0^^http://www.w3.org/2001/XMLSchema#integer","gc":"^^string"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - non-numeric SUM and AVG are unbound", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      literal("x"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT (SUM(?o) AS ?su) (AVG(?o) AS ?a) " +
        "WHERE { ?s <http://example.org/p> ?o }",
    ),
    ["{}"],
  );
});

Deno.test("WazooSparqlEngine - GROUP_CONCAT joins values with the separator", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      'SELECT (GROUP_CONCAT(?o; SEPARATOR = "--") AS ?gc) ' +
        "WHERE { VALUES ?o { 1 2 3 } }",
    ),
    [
      '{"gc":"1--2--3^^string"}',
    ],
  );
});

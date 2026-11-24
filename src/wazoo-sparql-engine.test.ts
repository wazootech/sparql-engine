import { DataFactory } from "@/term/mod.ts";
import { SparqlSyntaxError } from "@/parser/syntax-error.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { rejected } from "../test/thrown.ts";

const { namedNode, literal, quad } = DataFactory;

test("WazooSparqlEngine - malformed queries reject with a positioned SparqlSyntaxError", async () => {
  const engine = new WazooSparqlEngine({ store: new Store() });
  const error = await rejected(
    () =>
      engine.execute({
        query: "SELECT ?s WHERE { ?s <http://example.org/p> ?o } }",
      }),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, 50);
  assert.deepStrictEqual(error.token, "}");
  assert.deepStrictEqual(error.expected.includes("'EOF'"), true);
  assert.deepStrictEqual(
    error.message.startsWith("Syntax error at line 1, column 50"),
    true,
  );
});

test("WazooSparqlEngine - SELECT query BGP evaluation", async () => {
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
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Gregory"),
    ),
  );

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.head.vars, ["person", "name"]);
    assert.deepStrictEqual(result.data.results.bindings.length, 2);
    const names = result.data.results.bindings.map((b) => b.name.value).sort();
    assert.deepStrictEqual(names, ["Ethan", "Gregory"]);
  }
});

test("WazooSparqlEngine - FILTER numeric comparison and arithmetic", async () => {
  const store = new Store();
  const age = (person: string, years: string) =>
    quad(
      namedNode(`http://example.org/${person}`),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal(years, namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    );
  store.addQuad(age("alice", "28"));
  store.addQuad(age("bob", "17"));
  store.addQuad(age("carol", "30"));

  const engine = new WazooSparqlEngine({ store });
  const greater = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age FILTER(?age > 18) }",
  });
  assert.deepStrictEqual(greater.kind, "select");
  if (greater.kind === "select") {
    assert.deepStrictEqual(
      greater.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/carol"],
    );
  }

  const arithmetic = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age FILTER(?age / 2 > 10) }",
  });
  assert.deepStrictEqual(arithmetic.kind, "select");
  if (arithmetic.kind === "select") {
    assert.deepStrictEqual(
      arithmetic.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/carol"],
    );
  }

  const exact = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age FILTER(?age = 28.0) }",
  });
  assert.deepStrictEqual(exact.kind, "select");
  if (exact.kind === "select") {
    assert.deepStrictEqual(exact.data.results.bindings.length, 1);
  }
});

test("WazooSparqlEngine - FILTER string, language, STR and STRLEN", async () => {
  const store = new Store();
  const name = (person: string, value: string, language?: string) =>
    quad(
      namedNode(`http://example.org/${person}`),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      language ? literal(value, language) : literal(value),
    );
  store.addQuad(name("alice", "Ethan"));
  store.addQuad(name("bob", "Gregory"));
  store.addQuad(name("carol", "Carol", "en"));

  const engine = new WazooSparqlEngine({ store });
  const eq = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name = "Ethan") }',
  });
  assert.deepStrictEqual(eq.kind, "select");
  if (eq.kind === "select") {
    assert.deepStrictEqual(eq.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      eq.data.results.bindings[0].person.value,
      "http://example.org/alice",
    );
  }

  const lang = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name != "Carol"@en) }',
  });
  assert.deepStrictEqual(lang.kind, "select");
  if (lang.kind === "select") {
    assert.deepStrictEqual(
      lang.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/bob"],
    );
  }

  const strlen = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(STRLEN(?name) > 5) }",
  });
  assert.deepStrictEqual(strlen.kind, "select");
  if (strlen.kind === "select") {
    assert.deepStrictEqual(
      strlen.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/bob"],
    );
  }
});

test("WazooSparqlEngine - FILTER bound(), EBV, and error semantics", async () => {
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
  // Unbound variable in BOUND is an error; !BOUND(?missing) is true.
  const bound = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(!BOUND(?missing)) }",
  });
  assert.deepStrictEqual(bound.kind, "select");
  if (bound.kind === "select") {
    assert.deepStrictEqual(bound.data.results.bindings.length, 2);
  }

  // EBV of a lang-tagged literal is a type error: carol is dropped.
  const ebv = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name) }",
  });
  assert.deepStrictEqual(ebv.kind, "select");
  if (ebv.kind === "select") {
    assert.deepStrictEqual(ebv.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      ebv.data.results.bindings[0].person.value,
      "http://example.org/alice",
    );
  }

  // Comparing a lang-tagged literal with < is a type error: all dropped.
  const langError = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name < "Carol"@en) }',
  });
  assert.deepStrictEqual(langError.kind, "select");
  if (langError.kind === "select") {
    assert.deepStrictEqual(langError.data.results.bindings.length, 0);
  }
});

test("WazooSparqlEngine - ORDER BY expression (STRLEN and STR)", async () => {
  const store = new Store();
  const name = (person: string, value: string, language?: string) =>
    quad(
      namedNode(`http://example.org/${person}`),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      language ? literal(value, language) : literal(value),
    );
  store.addQuad(name("alice", "Ethan"));
  store.addQuad(name("bob", "Gregory"));
  store.addQuad(name("carol", "Carol", "en"));

  const engine = new WazooSparqlEngine({ store });
  const byLen = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY DESC(STRLEN(?name))",
  });
  assert.deepStrictEqual(byLen.kind, "select");
  if (byLen.kind === "select") {
    assert.deepStrictEqual(
      byLen.data.results.bindings.map((b) => b.person.value),
      [
        "http://example.org/bob",
        "http://example.org/alice",
        "http://example.org/carol",
      ],
    );
  }

  const byStr = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY STR(?name)",
  });
  assert.deepStrictEqual(byStr.kind, "select");
  if (byStr.kind === "select") {
    assert.deepStrictEqual(
      byStr.data.results.bindings.map((b) => b.person.value),
      [
        "http://example.org/carol",
        "http://example.org/alice",
        "http://example.org/bob",
      ],
    );
  }
});

test("WazooSparqlEngine - unsupported FILTER expression is rejected", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  // UNSUPPORTED_FUNC is not part of the ported surface, so it must still raise a
  // clear error rather than silently passing.
  await rejected(
    () =>
      engine.execute({
        query:
          "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(<http://example.org/unsupported>(?name)) }",
      }),
    Error,
    "Unsupported SPARQL expression",
  );
});

test("WazooSparqlEngine - ORDER BY sorts SELECT results by value", async () => {
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
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Gregory"),
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
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY ?name",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    // The lang-tagged literal (rdf:langString) sorts before the plain
    // xsd:string literals by datatype IRI, then lexically.
    assert.deepStrictEqual(
      result.data.results.bindings.map((b) => b.name.value),
      ["Carol", "Ethan", "Gregory"],
    );
  }
});

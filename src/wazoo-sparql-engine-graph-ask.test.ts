import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const { namedNode, literal, quad } = DataFactory;

test("WazooSparqlEngine - GRAPH ?g enumerates named graphs and binds the variable", async () => {
  const store = new Store();
  const name = (s: string, o: string, graph?: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal(o),
        graph === undefined
          ? undefined
          : namedNode(`http://example.org/${graph}`),
      ),
    );
  name("alice", "Default");
  name("alice", "G1", "g1");
  name("bob", "G1", "g1");
  name("alice", "G2", "g2");
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: "SELECT ?g ?s WHERE { GRAPH ?g { " +
      "?s <http://xmlns.com/foaf/0.1/name> ?n } } ORDER BY ?g ?s",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    const rows = result.data.results.bindings.map((b) =>
      `${b.g.value}:${b.s.value}`
    );
    // The default graph is not a named graph, so it never appears.
    assert.deepStrictEqual(rows, [
      "http://example.org/g1:http://example.org/alice",
      "http://example.org/g1:http://example.org/bob",
      "http://example.org/g2:http://example.org/alice",
    ]);
  }
});

test("WazooSparqlEngine - GRAPH joins with a preceding pattern", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/b"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      literal("2"),
      namedNode("http://example.org/g1"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o1 . " +
      "GRAPH <http://example.org/g1> { ?s <http://example.org/p> ?o } }",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.results.bindings.length, 1);
    assert.deepStrictEqual(result.data.results.bindings[0].o.value, "2");
  }
});

test("WazooSparqlEngine - ASK query evaluation", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/knows"),
      namedNode("http://example.org/bob"),
    ),
  );

  const engine = new WazooSparqlEngine({ store });

  const trueResult = await engine.execute({
    query:
      "ASK WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/knows> ?who }",
  });
  assert.deepStrictEqual(trueResult.kind, "ask");
  if (trueResult.kind === "ask") {
    assert.deepStrictEqual(trueResult.data.boolean, true);
  }

  const falseResult = await engine.execute({
    query:
      "ASK WHERE { <http://example.org/bob> <http://xmlns.com/foaf/0.1/knows> <http://example.org/charlie> }",
  });
  assert.deepStrictEqual(falseResult.kind, "ask");
  if (falseResult.kind === "ask") {
    assert.deepStrictEqual(falseResult.data.boolean, false);
  }
});

test("WazooSparqlEngine - DESCRIBE IRI returns outgoing arcs", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://example.org/name"),
      literal("Ethan"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://example.org/knows"),
      namedNode("http://example.org/alice"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "DESCRIBE <http://example.org/alice>",
  });
  assert.deepStrictEqual(result.kind, "construct");
  if (result.kind === "construct") {
    // Outgoing arcs only: bob knows alice is incoming and must be excluded.
    assert.deepStrictEqual(result.data.quads.length, 1);
    assert.deepStrictEqual(
      result.data.quads[0].predicate.value,
      "http://example.org/name",
    );
  }
});

test("WazooSparqlEngine - DESCRIBE variable describes bindings, skips literals", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      literal("hello"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/q"),
      namedNode("http://example.org/b"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/b"),
      namedNode("http://example.org/r"),
      namedNode("http://example.org/c"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "DESCRIBE ?o WHERE { <http://example.org/a> ?p ?o }",
  });
  assert.deepStrictEqual(result.kind, "construct");
  if (result.kind === "construct") {
    // ?o binds the literal (not describable) and :b; only :b is described.
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    );
    assert.deepStrictEqual(contents, [
      "http://example.org/b http://example.org/r http://example.org/c",
    ]);
  }
});
test("WazooSparqlEngine - DESCRIBE star describes the bound variables only", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/b"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/b"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/c"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/c"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "PREFIX : <http://example.org/> DESCRIBE * WHERE { :a :p ?o }",
  });
  assert.deepStrictEqual(result.kind, "construct");
  if (result.kind === "construct") {
    // DESCRIBE * describes the variables bound in the WHERE (?o → :b, :c),
    // not the constant :a; only :b has an outgoing arc. The result is a
    // deduped graph set.
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    );
    assert.deepStrictEqual(contents, [
      "http://example.org/b http://example.org/p http://example.org/c",
    ]);
  }
});

test("WazooSparqlEngine - CONSTRUCT query evaluation", async () => {
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
      "CONSTRUCT { ?person <http://schema.org/name> ?name } WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assert.deepStrictEqual(result.kind, "construct");
  if (result.kind === "construct") {
    assert.deepStrictEqual(result.data.quads.length, 1);
    assert.deepStrictEqual(
      result.data.quads[0].predicate.value,
      "http://schema.org/name",
    );
    assert.deepStrictEqual(result.data.quads[0].object.value, "Ethan");
  }
});

test("WazooSparqlEngine - CONSTRUCT result is a graph (duplicates collapse)", async () => {
  // CONSTRUCT returns an RDF graph — a set of triples. The join has two
  // solutions, one instantiating the template triple twice; both collapse to
  // a single `:s1 :p :o1` and one `:s2 :p :o1`.
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/o1"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/o1"),
    ),
  );

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "PREFIX : <http://example.org/> CONSTRUCT WHERE { :s1 :p ?o . ?s2 :p ?o }",
  });

  assert.deepStrictEqual(result.kind, "construct");
  if (result.kind === "construct") {
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    ).sort();
    assert.deepStrictEqual(contents, [
      "http://example.org/s1 http://example.org/p http://example.org/o1",
      "http://example.org/s2 http://example.org/p http://example.org/o1",
    ]);
  }
});

test("WazooSparqlEngine - INSERT DATA adds quads and returns void", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query:
      'INSERT DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Ethan" . ' +
      "<http://example.org/alice> <http://xmlns.com/foaf/0.1/age> 28 }",
  });

  assert.deepStrictEqual(result.kind, "void");
  assert.deepStrictEqual(
    store.countQuads(
      namedNode("http://example.org/alice"),
      null,
      null,
      null,
    ),
    2,
  );
  assert.deepStrictEqual(
    store.countQuads(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      null,
      null,
    ),
    1,
  );
});

import { assertEquals, assertRejects } from "@std/assert";
import { DataFactory, Store } from "n3";
import { NativeSparqlEngine } from "@/native-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

Deno.test("NativeSparqlEngine - SELECT query BGP evaluation", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.head.vars, ["person", "name"]);
    assertEquals(result.data.results.bindings.length, 2);
    const names = result.data.results.bindings.map((b) => b.name.value).sort();
    assertEquals(names, ["Alice", "Bob"]);
  }
});

Deno.test("NativeSparqlEngine - ORDER BY sorts SELECT results by value", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/carol"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Carol", "en"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY ?name",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // The lang-tagged literal (rdf:langString) sorts before the plain
    // xsd:string literals by datatype IRI, then lexically.
    assertEquals(
      result.data.results.bindings.map((b) => b.name.value),
      ["Carol", "Alice", "Bob"],
    );
  }
});

Deno.test("NativeSparqlEngine - ORDER BY DESC reverses the order", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY DESC(?name)",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.name.value),
      ["Bob", "Alice"],
    );
  }
});

Deno.test("NativeSparqlEngine - ORDER BY sorts integers numerically", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("9", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("10", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?age WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age } ORDER BY ?age",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/bob", "http://example.org/alice"],
    );
  }
});

Deno.test("NativeSparqlEngine - ORDER BY multiple keys with DESC", async () => {
  const store = new Store();
  for (
    const [person, age, name] of [
      ["alice", "28", "Alice"],
      ["bob", "20", "Bob"],
      ["carol", "30", "Carol"],
    ]
  ) {
    store.addQuad(
      quad(
        namedNode(`http://example.org/${person}`),
        namedNode("http://xmlns.com/foaf/0.1/age"),
        literal(age, namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      ),
    );
    store.addQuad(
      quad(
        namedNode(`http://example.org/${person}`),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal(name),
      ),
    );
  }

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?age ?name WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age . " +
      "?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY DESC(?age) ?name",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.person.value),
      [
        "http://example.org/carol",
        "http://example.org/alice",
        "http://example.org/bob",
      ],
    );
  }
});

Deno.test("NativeSparqlEngine - ORDER BY unbound key keeps evaluation order", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?person ?name ?missing WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY ?missing",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/bob"],
    );
  }
});

Deno.test(
  "NativeSparqlEngine - ORDER BY with an unsupported expression is rejected",
  async () => {
    const store = new Store();
    store.addQuad(
      quad(
        namedNode("http://example.org/alice"),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal("Alice"),
      ),
    );
    const engine = new NativeSparqlEngine({ store });
    await assertRejects(
      () =>
        engine.execute({
          query:
            "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY STRLEN(?name)",
        }),
      Error,
      "Unsupported ORDER BY expression",
    );
  },
);

Deno.test("NativeSparqlEngine - ASK query evaluation", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/knows"),
      namedNode("http://example.org/bob"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });

  const trueResult = await engine.execute({
    query:
      "ASK WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/knows> ?who }",
  });
  assertEquals(trueResult.kind, "ask");
  if (trueResult.kind === "ask") {
    assertEquals(trueResult.data.boolean, true);
  }

  const falseResult = await engine.execute({
    query:
      "ASK WHERE { <http://example.org/bob> <http://xmlns.com/foaf/0.1/knows> <http://example.org/charlie> }",
  });
  assertEquals(falseResult.kind, "ask");
  if (falseResult.kind === "ask") {
    assertEquals(falseResult.data.boolean, false);
  }
});

Deno.test("NativeSparqlEngine - CONSTRUCT query evaluation", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "CONSTRUCT { ?person <http://schema.org/name> ?name } WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    assertEquals(result.data.quads.length, 1);
    assertEquals(
      result.data.quads[0].predicate.value,
      "http://schema.org/name",
    );
    assertEquals(result.data.quads[0].object.value, "Alice");
  }
});

Deno.test("NativeSparqlEngine - INSERT DATA adds quads and returns void", async () => {
  const store = new Store();
  const engine = new NativeSparqlEngine({ store });

  const result = await engine.execute({
    query:
      'INSERT DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" . ' +
      "<http://example.org/alice> <http://xmlns.com/foaf/0.1/age> 28 }",
  });

  assertEquals(result.kind, "void");
  assertEquals(
    store.countQuads(
      namedNode("http://example.org/alice"),
      null,
      null,
      null,
    ),
    2,
  );
  assertEquals(
    store.countQuads(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      null,
      null,
    ),
    1,
  );
});

Deno.test("NativeSparqlEngine - INSERT DATA mints fresh blank nodes per execution", async () => {
  const store = new Store();
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query:
      "INSERT DATA { _:fresh <http://example.org/p> <http://example.org/o> }",
  });
  await engine.execute({
    query:
      "INSERT DATA { _:fresh <http://example.org/p> <http://example.org/o> }",
  });

  const subjects = new Set<string>();
  for (
    const q of store.match(null, namedNode("http://example.org/p"), null, null)
  ) {
    subjects.add(q.subject.value);
  }
  assertEquals(subjects.size, 2);
});

Deno.test("NativeSparqlEngine - INSERT DATA into a named graph", async () => {
  const store = new Store();
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query: "INSERT DATA { GRAPH <http://example.org/g> { " +
      '<http://example.org/x> <http://example.org/p> "v" } }',
  });

  const graphQuads = store.getQuads(
    namedNode("http://example.org/x"),
    namedNode("http://example.org/p"),
    null,
    namedNode("http://example.org/g"),
  );
  assertEquals(graphQuads.length, 1);
});

Deno.test("NativeSparqlEngine - DELETE DATA removes matching quads", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  const result = await engine.execute({
    query:
      'DELETE DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" }',
  });

  assertEquals(result.kind, "void");
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("NativeSparqlEngine - composite update runs all operations", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query:
      'INSERT DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Alice" } ; ' +
      'DELETE DATA { <http://example.org/bob> <http://xmlns.com/foaf/0.1/name> "Bob" }',
  });

  assertEquals(store.countQuads(null, null, null, null), 1);
  assertEquals(
    store.countQuads(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
      null,
    ),
    1,
  );
});

Deno.test("NativeSparqlEngine - unsupported update operation is rejected", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/x"),
      namedNode("http://example.org/p"),
      literal("v"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await assertRejects(
    () => engine.execute({ query: "CLEAR ALL" }),
    Error,
    "Unsupported SPARQL update operation: clear",
  );
});

Deno.test("NativeSparqlEngine - INSERT WHERE instantiates per solution", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query: "INSERT { <http://example.org/x> <http://example.org/saw> ?name } " +
      "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  const saw = store.getQuads(
    namedNode("http://example.org/x"),
    namedNode("http://example.org/saw"),
    null,
    null,
  ) as Array<{ object: { value: string } }>;
  assertEquals(saw.length, 2);
  assertEquals(
    saw.map((q) => q.object.value).sort(),
    ["Alice", "Bob"],
  );
});

Deno.test("NativeSparqlEngine - INSERT WHERE mints fresh blank nodes per solution", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Bob"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query: "INSERT { _:fresh <http://example.org/owns> ?name } " +
      "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  const subjects = new Set<string>();
  for (
    const q of store.match(
      null,
      namedNode("http://example.org/owns"),
      null,
      null,
    )
  ) {
    subjects.add(q.subject.value);
  }
  assertEquals(subjects.size, 2);
});

Deno.test("NativeSparqlEngine - DELETE WHERE shorthand removes matches", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("28"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query:
      "DELETE WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(store.countQuads(null, null, null, null), 1);
  assertEquals(
    store.countQuads(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      null,
      null,
    ),
    0,
  );
});

Deno.test("NativeSparqlEngine - DELETE/INSERT moves quads", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://example.org/p"),
      literal("1"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://example.org/p"),
      literal("2"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query: "DELETE { ?s <http://example.org/p> ?o } " +
      "INSERT { ?s <http://example.org/q> ?o } " +
      "WHERE { ?s <http://example.org/p> ?o }",
  });

  assertEquals(
    store.countQuads(null, namedNode("http://example.org/p"), null, null),
    0,
  );
  assertEquals(
    store.countQuads(null, namedNode("http://example.org/q"), null, null),
    2,
  );
});

Deno.test("NativeSparqlEngine - INSERT WHERE skips unbound template variables", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Alice"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

  await engine.execute({
    query:
      "INSERT { <http://example.org/x> <http://example.org/p> ?unbound } " +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(
    store.countQuads(
      namedNode("http://example.org/x"),
      namedNode("http://example.org/p"),
      null,
      null,
    ),
    0,
  );
});

import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals, assertRejects } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

Deno.test("WazooSparqlEngine - INSERT DATA mints fresh blank nodes per execution", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

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

Deno.test("WazooSparqlEngine - INSERT DATA into a named graph", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

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

Deno.test("WazooSparqlEngine - DELETE DATA removes matching quads", async () => {
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
      'DELETE DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Ethan" }',
  });

  assertEquals(result.kind, "void");
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("WazooSparqlEngine - composite update runs all operations", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/bob"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Gregory"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  await engine.execute({
    query:
      'INSERT DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Ethan" } ; ' +
      'DELETE DATA { <http://example.org/bob> <http://xmlns.com/foaf/0.1/name> "Gregory" }',
  });

  assertEquals(store.countQuads(null, null, null, null), 1);
  assertEquals(
    store.countQuads(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
      null,
    ),
    1,
  );
});

Deno.test("WazooSparqlEngine - unsupported update operation is rejected", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/x"),
      namedNode("http://example.org/p"),
      literal("v"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  await assertRejects(
    () =>
      (engine as unknown as {
        updateEvaluator: { executeUpdate: (u: unknown) => Promise<void> };
      }).updateEvaluator.executeUpdate({
        type: "update",
        prefixes: {},
        updates: [
          {
            type: "unsupported_op",
          } as unknown as import("@/parser/sparql-parser.ts").UpdateOperation,
        ],
      }),
    Error,
    "Unsupported SPARQL update operation: unsupported_op",
  );
});

Deno.test("WazooSparqlEngine - INSERT WHERE instantiates per solution", async () => {
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
    ["Ethan", "Gregory"],
  );
});

Deno.test("WazooSparqlEngine - INSERT WHERE mints fresh blank nodes per solution", async () => {
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

Deno.test("WazooSparqlEngine - DELETE WHERE shorthand removes matches", async () => {
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
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("28"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

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

Deno.test("WazooSparqlEngine - DELETE/INSERT moves quads", async () => {
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
  const engine = new WazooSparqlEngine({ store });

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

Deno.test("WazooSparqlEngine - INSERT WHERE skips unbound template variables", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Ethan"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

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

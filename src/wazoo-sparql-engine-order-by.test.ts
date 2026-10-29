import { DataFactory, XSD_BOOLEAN } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals, assertRejects } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

Deno.test("WazooSparqlEngine - ORDER BY DESC reverses the order", async () => {
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
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY DESC(?name)",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.name.value),
      ["Gregory", "Ethan"],
    );
  }
});

Deno.test("WazooSparqlEngine - ORDER BY sorts integers numerically", async () => {
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

  const engine = new WazooSparqlEngine({ store });
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

Deno.test("WazooSparqlEngine - ORDER BY multiple keys with DESC", async () => {
  const store = new Store();
  for (
    const [person, age, name] of [
      ["alice", "28", "Ethan"],
      ["bob", "20", "Gregory"],
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

  const engine = new WazooSparqlEngine({ store });
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

Deno.test("WazooSparqlEngine - ORDER BY unbound key keeps evaluation order", async () => {
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
  "WazooSparqlEngine - ORDER BY with an unsupported expression is rejected",
  async () => {
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
    // STRLEN is supported now; only genuinely unsupported expressions
    // (custom function calls) are rejected.
    const ordered = await engine.execute({
      query:
        "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY STRLEN(?name)",
    });
    assertEquals(ordered.kind, "select");
    if (ordered.kind === "select") {
      assertEquals(
        ordered.data.results.bindings.map((b) => b.person.value),
        ["http://example.org/alice", "http://example.org/bob"],
      );
    }

    await assertRejects(
      () =>
        engine.execute({
          query:
            "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY <http://example.org/customFn>(?name)",
        }),
      Error,
      "Unsupported SPARQL expression: functionCall",
    );
  },
);

Deno.test("WazooSparqlEngine - custom IRI functions evaluate through the registry", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const addName = (s: string, o: string) =>
    store.addQuad(quad(ex(s), ex("name"), literal(o)));
  addName("a", "alice");
  addName("b", "bob");
  addName("c", "carol");
  const engine = new WazooSparqlEngine({
    store,
    functions: {
      "http://example.org/startsWithA": (args) => {
        const name = args[0];
        if (name === undefined || name.termType !== "Literal") {
          return undefined;
        }
        return literal(
          String(name.value.startsWith("a")),
          namedNode(XSD_BOOLEAN),
        );
      },
      "http://example.org/upper": (args) => {
        const name = args[0];
        if (name === undefined || name.termType !== "Literal") {
          return undefined;
        }
        return literal(name.value.toUpperCase());
      },
      "http://example.org/tag": (args) =>
        literal(
          `t:${args[0]?.value ?? "?"}/${args[1]?.value ?? "?"}`,
        ),
    },
  });

  // FILTER: the registered function narrows the rows (alice only).
  const filtered = await engine.execute({
    query: "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
      "FILTER(<http://example.org/startsWithA>(?n)) }",
  });
  assertEquals(filtered.kind, "select");
  if (filtered.kind === "select") {
    assertEquals(
      filtered.data.results.bindings.map((b) => b.s.value),
      ["http://example.org/a"],
    );
  }

  // Projection expression: the function result becomes a projected value.
  const projected = await engine.execute({
    query: "SELECT ?s (<http://example.org/startsWithA>(?n) AS ?flag) " +
      "WHERE { ?s <http://example.org/name> ?n }",
  });
  assertEquals(projected.kind, "select");
  if (projected.kind === "select") {
    assertEquals(
      projected.data.results.bindings.map((b) =>
        `${b.s.value}:${(b.flag as { value: string }).value}`
      ).sort(),
      [
        "http://example.org/a:true",
        "http://example.org/b:false",
        "http://example.org/c:false",
      ],
    );
  }

  // BIND in the WHERE clause: the function binds a fresh variable.
  const bound = await engine.execute({
    query: "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
      'BIND(<http://example.org/upper>(?n) AS ?u) FILTER(?u = "BOB") }',
  });
  assertEquals(bound.kind, "select");
  if (bound.kind === "select") {
    assertEquals(
      bound.data.results.bindings.map((b) => b.s.value),
      ["http://example.org/b"],
    );
  }

  // ORDER BY: the function sorts without raising (descending upper-cased
  // names: CAROL > BOB > ALICE).
  const ordered = await engine.execute({
    query: "SELECT ?s WHERE { ?s <http://example.org/name> ?n } " +
      "ORDER BY DESC(<http://example.org/upper>(?n))",
  });
  assertEquals(ordered.kind, "select");
  if (ordered.kind === "select") {
    assertEquals(
      ordered.data.results.bindings.map((b) => b.s.value),
      ["http://example.org/c", "http://example.org/b", "http://example.org/a"],
    );
  }

  // Multi-argument functions receive each evaluated argument.
  const multi = await engine.execute({
    query: "SELECT (<http://example.org/tag>(?s, ?n) AS ?t) " +
      "WHERE { ?s <http://example.org/name> ?n } ORDER BY ?s LIMIT 1",
  });
  assertEquals(multi.kind, "select");
  if (multi.kind === "select") {
    assertEquals(
      (multi.data.results.bindings[0].t as { value: string }).value,
      "t:http://example.org/a/alice",
    );
  }

  // A type error (undefined) drops the row in FILTER — the builtin contract.
  const typeError = await engine.execute({
    query: "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
      "FILTER(<http://example.org/startsWithA>(?s)) }",
  });
  assertEquals(typeError.kind, "select");
  if (typeError.kind === "select") {
    assertEquals(typeError.data.results.bindings, []);
  }

  // Unregistered IRIs keep raising the clear error.
  await assertRejects(
    () =>
      engine.execute({
        query: "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
          "FILTER(<http://example.org/notRegistered>(?n)) }",
      }),
    Error,
    "Unsupported SPARQL expression: functionCall",
  );
});

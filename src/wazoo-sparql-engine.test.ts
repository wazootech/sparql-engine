import { assertEquals, assertRejects } from "@std/assert";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { blankNode, namedNode, literal, quad } = DataFactory;

Deno.test("WazooSparqlEngine - SELECT query BGP evaluation", async () => {
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

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.head.vars, ["person", "name"]);
    assertEquals(result.data.results.bindings.length, 2);
    const names = result.data.results.bindings.map((b) => b.name.value).sort();
    assertEquals(names, ["Ethan", "Gregory"]);
  }
});

Deno.test("WazooSparqlEngine - FILTER numeric comparison and arithmetic", async () => {
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
  assertEquals(greater.kind, "select");
  if (greater.kind === "select") {
    assertEquals(
      greater.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/carol"],
    );
  }

  const arithmetic = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age FILTER(?age / 2 > 10) }",
  });
  assertEquals(arithmetic.kind, "select");
  if (arithmetic.kind === "select") {
    assertEquals(
      arithmetic.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/carol"],
    );
  }

  const exact = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/age> ?age FILTER(?age = 28.0) }",
  });
  assertEquals(exact.kind, "select");
  if (exact.kind === "select") {
    assertEquals(exact.data.results.bindings.length, 1);
  }
});

Deno.test("WazooSparqlEngine - FILTER string, language, STR and STRLEN", async () => {
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
  assertEquals(eq.kind, "select");
  if (eq.kind === "select") {
    assertEquals(eq.data.results.bindings.length, 1);
    assertEquals(
      eq.data.results.bindings[0].person.value,
      "http://example.org/alice",
    );
  }

  const lang = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name != "Carol"@en) }',
  });
  assertEquals(lang.kind, "select");
  if (lang.kind === "select") {
    assertEquals(
      lang.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/bob"],
    );
  }

  const strlen = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(STRLEN(?name) > 5) }",
  });
  assertEquals(strlen.kind, "select");
  if (strlen.kind === "select") {
    assertEquals(
      strlen.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/bob"],
    );
  }
});

Deno.test("WazooSparqlEngine - FILTER bound(), EBV, and error semantics", async () => {
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
  assertEquals(bound.kind, "select");
  if (bound.kind === "select") {
    assertEquals(bound.data.results.bindings.length, 2);
  }

  // EBV of a lang-tagged literal is a type error: carol is dropped.
  const ebv = await engine.execute({
    query:
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name) }",
  });
  assertEquals(ebv.kind, "select");
  if (ebv.kind === "select") {
    assertEquals(ebv.data.results.bindings.length, 1);
    assertEquals(
      ebv.data.results.bindings[0].person.value,
      "http://example.org/alice",
    );
  }

  // Comparing a lang-tagged literal with < is a type error: all dropped.
  const langError = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name < "Carol"@en) }',
  });
  assertEquals(langError.kind, "select");
  if (langError.kind === "select") {
    assertEquals(langError.data.results.bindings.length, 0);
  }
});

Deno.test("WazooSparqlEngine - ORDER BY expression (STRLEN and STR)", async () => {
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
  assertEquals(byLen.kind, "select");
  if (byLen.kind === "select") {
    assertEquals(
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
  assertEquals(byStr.kind, "select");
  if (byStr.kind === "select") {
    assertEquals(
      byStr.data.results.bindings.map((b) => b.person.value),
      [
        "http://example.org/carol",
        "http://example.org/alice",
        "http://example.org/bob",
      ],
    );
  }
});

Deno.test("WazooSparqlEngine - unsupported FILTER expression is rejected", async () => {
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
  await assertRejects(
    () =>
      engine.execute({
        query:
          "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(<http://example.org/unsupported>(?name)) }",
      }),
    Error,
    "Unsupported SPARQL expression",
  );
});

Deno.test("WazooSparqlEngine - ORDER BY sorts SELECT results by value", async () => {
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
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // The lang-tagged literal (rdf:langString) sorts before the plain
    // xsd:string literals by datatype IRI, then lexically.
    assertEquals(
      result.data.results.bindings.map((b) => b.name.value),
      ["Carol", "Ethan", "Gregory"],
    );
  }
});

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

Deno.test("WazooSparqlEngine - OPTIONAL extends matches and keeps unmatched unbound", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p ?o WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n OPTIONAL { ?p <http://xmlns.com/foaf/0.1/age> ?o } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const byPerson = new Map(
      result.data.results.bindings.map((b) => [b.p.value, b.o?.value]),
    );
    assertEquals(byPerson.get("http://example.org/alice"), "28");
    assertEquals(byPerson.get("http://example.org/carol"), "30");
    // bob has no age: the solution survives with ?o unbound
    assertEquals(byPerson.get("http://example.org/bob"), undefined);
    assertEquals(byPerson.size, 3);
  }
});

Deno.test("WazooSparqlEngine - OPTIONAL filter drops a join and keeps the solution unextended", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p ?o WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n OPTIONAL { ?p <http://xmlns.com/foaf/0.1/age> ?o FILTER(?o > 28) } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const byPerson = new Map(
      result.data.results.bindings.map((b) => [b.p.value, b.o?.value]),
    );
    // alice's join (28) fails the filter, so she is kept without ?o
    assertEquals(byPerson.get("http://example.org/alice"), undefined);
    assertEquals(byPerson.get("http://example.org/carol"), "30");
    assertEquals(byPerson.get("http://example.org/bob"), undefined);
    assertEquals(byPerson.size, 3);
  }
});

Deno.test("WazooSparqlEngine - OPTIONAL filter can reference an outer variable", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p ?o WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n OPTIONAL { ?p <http://xmlns.com/foaf/0.1/age> ?o FILTER(?p = <http://example.org/alice>) } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const byPerson = new Map(
      result.data.results.bindings.map((b) => [b.p.value, b.o?.value]),
    );
    assertEquals(byPerson.get("http://example.org/alice"), "28");
    assertEquals(byPerson.get("http://example.org/carol"), undefined);
    assertEquals(byPerson.get("http://example.org/bob"), undefined);
    assertEquals(byPerson.size, 3);
  }
});

Deno.test("WazooSparqlEngine - OPTIONAL nests inside OPTIONAL", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("knows"), ex("bob")));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p ?q WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n OPTIONAL { ?p <http://xmlns.com/foaf/0.1/knows> ?q OPTIONAL { ?q <http://xmlns.com/foaf/0.1/name> ?qn } } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const byPerson = new Map(
      result.data.results.bindings.map((b) => [b.p.value, b.q?.value]),
    );
    // alice knows bob (and bob has a name, but ?qn is not projected)
    assertEquals(
      byPerson.get("http://example.org/alice"),
      "http://example.org/bob",
    );
    // bob knows nobody: ?q unbound
    assertEquals(byPerson.get("http://example.org/bob"), undefined);
  }
});

Deno.test("WazooSparqlEngine - MINUS eliminates solutions sharing a bound variable", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n MINUS { ?p <http://xmlns.com/foaf/0.1/age> ?a } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.p.value),
      ["http://example.org/bob"],
    );
  }
});

Deno.test("WazooSparqlEngine - MINUS with no shared variables keeps all solutions", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n MINUS { ?x <http://xmlns.com/foaf/0.1/age> ?y } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 3);
  }
});

Deno.test("WazooSparqlEngine - MINUS applies its own FILTER inside the group", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n MINUS { ?p <http://xmlns.com/foaf/0.1/age> ?a FILTER(?a > 29) } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // carol (30) passes the filter and is eliminated; alice (28) is not in the minus set
    assertEquals(
      result.data.results.bindings.map((b) => b.p.value).sort(),
      ["http://example.org/alice", "http://example.org/bob"],
    );
  }
});

Deno.test("WazooSparqlEngine - UNION combines branch solutions as a multiset", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?s WHERE { { ?s <http://xmlns.com/foaf/0.1/name> ?n } UNION { ?s <http://xmlns.com/foaf/0.1/age> ?a } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const people = result.data.results.bindings.map((b) => b.s.value).sort();
    // alice and carol appear twice: once from each branch (multiset union)
    assertEquals(people, [
      "http://example.org/alice",
      "http://example.org/alice",
      "http://example.org/bob",
      "http://example.org/carol",
      "http://example.org/carol",
    ]);
  }
});

Deno.test("WazooSparqlEngine - UNION branches can bind different variables", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?n ?a WHERE { { ?s <http://xmlns.com/foaf/0.1/name> ?n } UNION { ?s <http://xmlns.com/foaf/0.1/age> ?a } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const bindings = result.data.results.bindings;
    assertEquals(bindings.length, 2);
    assertEquals(bindings[0].n?.value, "Ethan");
    assertEquals(bindings[0].a, undefined);
    assertEquals(bindings[1].n, undefined);
    assertEquals(bindings[1].a?.value, "28");
  }
});

Deno.test("WazooSparqlEngine - UNION in a sequence joins with preceding patterns", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Ethan")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Gregory")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?s ?n ?a WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n . { ?s <http://xmlns.com/foaf/0.1/name> ?n2 } UNION { ?s <http://xmlns.com/foaf/0.1/age> ?a } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const rows = result.data.results.bindings
      .map((b) => [b.s.value, b.n?.value, b.a?.value])
      .sort() as Array<Array<string | undefined>>;
    assertEquals(rows, [
      ["http://example.org/alice", "Ethan", undefined],
      ["http://example.org/alice", "Ethan", "28"],
      ["http://example.org/bob", "Gregory", undefined],
      ["http://example.org/carol", "Carol", undefined],
      ["http://example.org/carol", "Carol", "30"],
    ]);
  }
});

Deno.test("WazooSparqlEngine - GRAPH scopes patterns to a named graph", async () => {
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

  const scoped = await engine.execute({
    query: "SELECT ?s ?n WHERE { GRAPH <http://example.org/g1> { " +
      "?s <http://xmlns.com/foaf/0.1/name> ?n } } ORDER BY ?n",
  });
  assertEquals(scoped.kind, "select");
  if (scoped.kind === "select") {
    // Only g1's quads match; the default graph and g2 are excluded.
    assertEquals(
      scoped.data.results.bindings.map((b) => b.n.value),
      ["G1", "G1"],
    );
  }
});

Deno.test("WazooSparqlEngine - GRAPH ?g enumerates named graphs and binds the variable", async () => {
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
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const rows = result.data.results.bindings.map((b) =>
      `${b.g.value}:${b.s.value}`
    );
    // The default graph is not a named graph, so it never appears.
    assertEquals(rows, [
      "http://example.org/g1:http://example.org/alice",
      "http://example.org/g1:http://example.org/bob",
      "http://example.org/g2:http://example.org/alice",
    ]);
  }
});

Deno.test("WazooSparqlEngine - GRAPH joins with a preceding pattern", async () => {
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
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(result.data.results.bindings[0].o.value, "2");
  }
});

Deno.test("WazooSparqlEngine - ASK query evaluation", async () => {
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

Deno.test("WazooSparqlEngine - DESCRIBE IRI returns outgoing arcs", async () => {
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
  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    // Outgoing arcs only: bob knows alice is incoming and must be excluded.
    assertEquals(result.data.quads.length, 1);
    assertEquals(
      result.data.quads[0].predicate.value,
      "http://example.org/name",
    );
  }
});

Deno.test("WazooSparqlEngine - DESCRIBE variable describes bindings, skips literals", async () => {
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
  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    // ?o binds the literal (not describable) and :b; only :b is described.
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    );
    assertEquals(contents, [
      "http://example.org/b http://example.org/r http://example.org/c",
    ]);
  }
});
Deno.test("WazooSparqlEngine - DESCRIBE star describes the bound variables only", async () => {
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
  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    // DESCRIBE * describes the variables bound in the WHERE (?o → :b, :c),
    // not the constant :a; only :b has an outgoing arc. The result is a
    // deduped graph set.
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    );
    assertEquals(contents, [
      "http://example.org/b http://example.org/p http://example.org/c",
    ]);
  }
});

Deno.test("WazooSparqlEngine - CONSTRUCT query evaluation", async () => {
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

  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    assertEquals(result.data.quads.length, 1);
    assertEquals(
      result.data.quads[0].predicate.value,
      "http://schema.org/name",
    );
    assertEquals(result.data.quads[0].object.value, "Ethan");
  }
});

Deno.test("WazooSparqlEngine - CONSTRUCT result is a graph (duplicates collapse)", async () => {
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

  assertEquals(result.kind, "construct");
  if (result.kind === "construct") {
    const contents = result.data.quads.map((q) =>
      `${q.subject.value} ${q.predicate.value} ${q.object.value}`
    ).sort();
    assertEquals(contents, [
      "http://example.org/s1 http://example.org/p http://example.org/o1",
      "http://example.org/s2 http://example.org/p http://example.org/o1",
    ]);
  }
});

Deno.test("WazooSparqlEngine - INSERT DATA adds quads and returns void", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query:
      'INSERT DATA { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> "Ethan" . ' +
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

function aggregateEngine(): WazooSparqlEngine {
  const store = new Store();
  const num = (s: string, v: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode("http://example.org/p"),
        literal(v, namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      ),
    );
  num("a", "1");
  num("a", "2");
  num("a", "3");
  num("b", "2");
  num("b", "4");
  return new WazooSparqlEngine({ store });
}

async function aggregateRows(engine: WazooSparqlEngine, query: string) {
  const result = await engine.execute({ query });
  assertEquals(result.kind, "select");
  if (result.kind !== "select") {
    return [];
  }
  return result.data.results.bindings.map((b) => {
    const rec: Record<string, string> = {};
    for (const key of Object.keys(b)) {
      const value = b[key];
      rec[key] = value.type === "literal"
        ? `${value.value}^^${value.datatype ?? "string"}`
        : (value as { value: string }).value;
    }
    return JSON.stringify(rec);
  });
}

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

Deno.test("WazooSparqlEngine - AVG of doubles produces canonical double forms", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT (AVG(?o) AS ?a) WHERE { VALUES ?o { 1.0e0 2.0e0 } }",
    ),
    ['{"a":"1.5E0^^http://www.w3.org/2001/XMLSchema#double"}'],
  );
});

Deno.test("WazooSparqlEngine - ORDER BY an aggregate expression orders the groups", async () => {
  const engine = aggregateEngine();
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s <http://example.org/p> ?o } " +
        "GROUP BY ?s ORDER BY DESC(COUNT(?o)) ?s",
    ),
    [
      '{"s":"http://example.org/a","c":"3^^http://www.w3.org/2001/XMLSchema#integer"}',
      '{"s":"http://example.org/b","c":"2^^http://www.w3.org/2001/XMLSchema#integer"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - SELECT * wildcard projects all bound variables", async () => {
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
      literal("28", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT * WHERE { <http://example.org/alice> ?p ?o }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.head.vars.sort(),
      ["o", "p"],
    );
    assertEquals(result.data.results.bindings.length, 2);
    assertEquals(
      result.data.results.bindings.map((b) => b.p.value).sort(),
      [
        "http://xmlns.com/foaf/0.1/age",
        "http://xmlns.com/foaf/0.1/name",
      ],
    );
    for (const binding of result.data.results.bindings) {
      assertEquals(Object.keys(binding).sort(), ["o", "p"]);
    }
  }
});

Deno.test("WazooSparqlEngine - VALUES block joins as a multiset with UNDEF rows", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT ?s ?n WHERE { VALUES (?s ?n) " +
      "{ (<http://example.org/a> 1) (<http://example.org/a> 1) (UNDEF 2) } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 3);
    // Duplicate rows survive; the UNDEF row leaves ?s unbound.
    assertEquals(
      result.data.results.bindings[2],
      {
        n: {
          type: "literal",
          value: "2",
          datatype: "http://www.w3.org/2001/XMLSchema#integer",
        },
      },
    );
  }
});

Deno.test("WazooSparqlEngine - VALUES block constrains a preceding BGP join", async () => {
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
      namedNode("http://example.org/c"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/d"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT ?s ?n WHERE { ?s <http://example.org/p> ?o . " +
      "VALUES (?s ?n) { (<http://example.org/a> 1) (<http://example.org/c> 2) } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const rows = result.data.results.bindings.map((b) => b.n.value).sort();
    assertEquals(rows, ["1", "2"]);
  }
});

Deno.test("WazooSparqlEngine - BIND extends solutions and keeps error solutions unbound", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/b"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?x ?u WHERE { ?x <http://example.org/p> ?y . BIND(STR(?z) AS ?u) }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // The expression errors on unbound ?z; the solution survives unextended.
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(result.data.results.bindings[0], {
      x: { type: "uri", value: "http://example.org/a" },
    });
  }
});

Deno.test("WazooSparqlEngine - DISTINCT removes duplicate projected solutions", async () => {
  const store = new Store();
  for (const o of ["b", "c"]) {
    store.addQuad(
      quad(
        namedNode("http://example.org/a"),
        namedNode("http://example.org/p"),
        namedNode(`http://example.org/${o}`),
      ),
    );
  }
  store.addQuad(
    quad(
      namedNode("http://example.org/b"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/c"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT DISTINCT ?o WHERE { ?s <http://example.org/p> ?o }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // ?o binds c twice (a->c and b->c); DISTINCT collapses it.
    assertEquals(result.data.results.bindings.length, 2);
  }
});

Deno.test("WazooSparqlEngine - REDUCED dedups like DISTINCT", async () => {
  // REDUCED is a permitted hint to drop duplicates; this engine implements
  // it as full dedup (REDUCED ≡ DISTINCT), matching Comunica/Oxigraph.
  const store = new Store();
  for (
    const [s, o] of [
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ]
  ) {
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode("http://example.org/p"),
        namedNode(`http://example.org/${o}`),
      ),
    );
  }
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT REDUCED ?o WHERE { ?s <http://example.org/p> ?o }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // ?o binds c twice (a->c and b->c); REDUCED collapses it like DISTINCT.
    assertEquals(result.data.results.bindings.length, 2);
  }
});

Deno.test("WazooSparqlEngine - DISTINCT with ORDER BY keeps order and dedups", async () => {
  const store = new Store();
  for (
    const [s, o] of [
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ]
  ) {
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode("http://example.org/p"),
        namedNode(`http://example.org/${o}`),
      ),
    );
  }
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT DISTINCT ?o WHERE { ?s <http://example.org/p> ?o } " +
      "ORDER BY ?o",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.o.value),
      ["http://example.org/c", "http://example.org/d"],
    );
  }
});

Deno.test("WazooSparqlEngine - DISTINCT dedups projected expressions", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      literal("hello", "en"),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/b"),
      namedNode("http://example.org/p"),
      literal("world", "en"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT DISTINCT (LANG(?o) AS ?lang) WHERE { ?s <http://example.org/p> ?o }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // Both literals are en-tagged, so the projected ?lang binds "en" twice.
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(result.data.results.bindings[0].lang.value, "en");
  }
});

Deno.test("WazooSparqlEngine - DISTINCT keeps bound and unbound solutions apart", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/c"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT DISTINCT ?o ?x WHERE { ?s <http://example.org/p> ?o OPTIONAL { ?s <http://example.org/q> ?x } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    // {?o: c, ?x: unbound} and any bound variant are different solutions:
    // DISTINCT must not collapse a missing key onto a present one.
    const keys = result.data.results.bindings.map((b) =>
      `${b.o.value}|${b.x ? b.x.value : "UNBOUND"}`
    );
    assertEquals(keys, ["http://example.org/c|UNBOUND"]);
  }
});

Deno.test("WazooSparqlEngine - LIMIT and OFFSET slice ordered results", async () => {
  const store = new Store();
  for (const o of ["d", "b", "c", "a"]) {
    store.addQuad(
      quad(
        namedNode("http://example.org/s"),
        namedNode("http://example.org/p"),
        namedNode(`http://example.org/${o}`),
      ),
    );
  }
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT ?o WHERE { ?s <http://example.org/p> ?o } " +
      "ORDER BY ?o LIMIT 2 OFFSET 1",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => b.o.value),
      ["http://example.org/b", "http://example.org/c"],
    );
  }
});

function pathEngine(): WazooSparqlEngine {
  const store = new Store();
  const edge = (s: string, p: string, o: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode(`http://example.org/${p}`),
        namedNode(`http://example.org/${o}`),
      ),
    );
  // a -> b -> c, a -> d -> c (two routes), plus unrelated edges.
  edge("a", "p", "b");
  edge("b", "p", "c");
  edge("a", "p", "d");
  edge("d", "p", "c");
  edge("c", "q", "w");
  edge("z", "q", "w");
  edge("x", "p", "y");
  return new WazooSparqlEngine({ store });
}

async function pathBindings(engine: WazooSparqlEngine, query: string) {
  const result = await engine.execute({ query });
  assertEquals(result.kind, "select");
  if (result.kind !== "select") {
    return [];
  }
  return result.data.results.bindings.map((b) =>
    `${b.x ? b.x.value : "?"}->${b.y ? b.y.value : "?"}`
  ).sort();
}

Deno.test("WazooSparqlEngine - property path + traverses a sequence", async () => {
  const engine = pathEngine();
  assertEquals(
    await pathBindings(
      engine,
      "SELECT ?x ?y WHERE { ?x <http://example.org/p>/<http://example.org/q> ?y }",
    ),
    [
      "http://example.org/b->http://example.org/w",
      "http://example.org/d->http://example.org/w",
    ],
  );
});

Deno.test("WazooSparqlEngine - property path ^ reverses an edge", async () => {
  const engine = pathEngine();
  assertEquals(
    await pathBindings(
      engine,
      "SELECT ?x ?y WHERE { ?x ^<http://example.org/p> ?y }",
    ),
    [
      "http://example.org/b->http://example.org/a",
      "http://example.org/c->http://example.org/b",
      "http://example.org/c->http://example.org/d",
      "http://example.org/d->http://example.org/a",
      "http://example.org/y->http://example.org/x",
    ],
  );
});

Deno.test("WazooSparqlEngine - property path | alternates with deduplication", async () => {
  const engine = pathEngine();
  assertEquals(
    await pathBindings(
      engine,
      "SELECT ?x ?y WHERE { ?x <http://example.org/p>|<http://example.org/q> ?y }",
    ),
    [
      "http://example.org/a->http://example.org/b",
      "http://example.org/a->http://example.org/d",
      "http://example.org/b->http://example.org/c",
      "http://example.org/c->http://example.org/w",
      "http://example.org/d->http://example.org/c",
      "http://example.org/x->http://example.org/y",
      "http://example.org/z->http://example.org/w",
    ],
  );
});

Deno.test("WazooSparqlEngine - property path ? is zero-or-one with reflexivity", async () => {
  const engine = pathEngine();
  const bindings = await pathBindings(
    engine,
    "SELECT ?x ?y WHERE { <http://example.org/a> <http://example.org/p>? ?y }",
  );
  // a itself plus a's p-targets b and d (the constant subject is not
  // projected, so the binding only carries ?y).
  assertEquals(bindings, [
    "?->http://example.org/a",
    "?->http://example.org/b",
    "?->http://example.org/d",
  ]);
});

Deno.test("WazooSparqlEngine - property path + is one-or-more transitive closure", async () => {
  const engine = pathEngine();
  const bindings = await pathBindings(
    engine,
    "SELECT ?x ?y WHERE { <http://example.org/a> <http://example.org/p>+ ?y }",
  );
  assertEquals(bindings, [
    "?->http://example.org/b",
    "?->http://example.org/c",
    "?->http://example.org/d",
  ]);
});

Deno.test("WazooSparqlEngine - property path * is reflexive-transitive closure over all nodes", async () => {
  const engine = pathEngine();
  const bindings = await pathBindings(
    engine,
    "SELECT ?x ?y WHERE { ?x <http://example.org/p>* ?y }",
  );
  // Reflexive pairs cover every graph node (including w, z, x, y, v-free).
  const reflexive = bindings.filter((b) => {
    const [x, y] = b.split("->");
    return x === y;
  });
  assertEquals(reflexive.length, 8); // a, b, c, d, w, x, y, z
  // Multi-hop reachability deduplicates the two routes a->c.
  const reachable = bindings.filter((b) =>
    b === "http://example.org/a->http://example.org/c"
  );
  assertEquals(reachable.length, 1);
});

Deno.test("WazooSparqlEngine - property path ! negates a property set", async () => {
  const engine = pathEngine();
  assertEquals(
    await pathBindings(
      engine,
      "SELECT ?x ?y WHERE { ?x !<http://example.org/p> ?y }",
    ),
    [
      "http://example.org/c->http://example.org/w",
      "http://example.org/z->http://example.org/w",
    ],
  );
});

Deno.test("WazooSparqlEngine - nested inverse sequence path", async () => {
  const engine = pathEngine();
  // ^(p/q) connects x to y when y --p--> m --q--> x. In the fixture the only
  // p-then-q chains are b -p-> c -q-> w and d -p-> c -q-> w, so the pairs
  // are (w, b) and (w, d).
  const bindings = await pathBindings(
    engine,
    "SELECT ?x ?y WHERE { ?x ^(<http://example.org/p>/<http://example.org/q>) ?y }",
  );
  assertEquals(bindings, [
    "http://example.org/w->http://example.org/b",
    "http://example.org/w->http://example.org/d",
  ]);
});

Deno.test("WazooSparqlEngine - property path joins with an incoming binding", async () => {
  const engine = pathEngine();
  // The first pattern binds ?z to a's p-targets {b, d}; the path result's
  // ?x is then constrained to match ?z, giving b -p+-> c and d -p+-> c.
  const bindings = await pathBindings(
    engine,
    "SELECT ?x ?y WHERE { <http://example.org/a> <http://example.org/p> ?z . " +
      "?x <http://example.org/p>+ ?y . FILTER(?x = ?z) }",
  );
  assertEquals(bindings, [
    "http://example.org/b->http://example.org/c",
    "http://example.org/d->http://example.org/c",
  ]);
});

Deno.test("WazooSparqlEngine - property path works inside GRAPH scope", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const g1 = namedNode("http://example.org/g1");
  store.addQuad(quad(ex("a"), ex("p"), ex("b"), g1));
  store.addQuad(quad(ex("b"), ex("p"), ex("c"), g1));

  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      `SELECT ?y WHERE { GRAPH <http://example.org/g1> { <http://example.org/a> <http://example.org/p>+ ?y } }`,
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const values = result.data.results.bindings.map((b) => b.y.value).sort();
    assertEquals(values, ["http://example.org/b", "http://example.org/c"]);
  }
});

const XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * bindValue runs a SELECT query against the engine and returns the first
 * binding's value for the given variable as the wire format.
 */
async function bindValue(
  engine: WazooSparqlEngine,
  query: string,
  variable: string,
): Promise<
  { type: string; value: string; datatype?: string; lang?: string } | null
> {
  const result = await engine.execute({ query });
  if (result.kind !== "select") {
    throw new Error(`expected select, got ${result.kind}`);
  }
  const binding = result.data.results.bindings[0];
  const value = binding[variable];
  if (value === undefined) {
    return null;
  }
  const out: { type: string; value: string; datatype?: string; lang?: string } =
    {
      type: value.type,
      value: typeof value.value === "string"
        ? value.value
        : JSON.stringify(value.value),
    };
  if (value.type === "literal") {
    if (value.datatype !== undefined) {
      out.datatype = value.datatype;
    }
    if (value["xml:lang"] !== undefined) {
      out.lang = value["xml:lang"];
    }
  }
  return out;
}

function emptyEngine(): WazooSparqlEngine {
  return new WazooSparqlEngine({ store: new Store() });
}

Deno.test("WazooSparqlEngine - REGEX, CONTAINS, STRSTARTS, STRENDS", async () => {
  const engine = emptyEngine();
  const regex = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REGEX("abc", "^a", "i") AS ?v) }`,
    "v",
  );
  assertEquals(regex, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const noMatch = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REGEX("abc", "^z") AS ?v) }`,
    "v",
  );
  assertEquals(noMatch, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
  // A malformed pattern is an evaluation error (unbound), not a throw.
  const badPattern = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REGEX("abc", "(") AS ?v) }`,
    "v",
  );
  assertEquals(badPattern, null);
  const combined = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(CONTAINS("abc", "b") AS ?v) }`,
    "v",
  );
  assertEquals(combined, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
});

Deno.test("WazooSparqlEngine - REPLACE with groups, flags, and language", async () => {
  const engine = emptyEngine();
  const grouped = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REPLACE("abab", "a(b)", "[$1]") AS ?v) }`,
    "v",
  );
  assertEquals(grouped, { type: "literal", value: "[b][b]" });
  const flagged = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REPLACE("Abc", "b", "X", "i") AS ?v) }`,
    "v",
  );
  assertEquals(flagged, { type: "literal", value: "AXc" });
  const lang = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REPLACE("abc"@en, "b", "X") AS ?v) }`,
    "v",
  );
  assertEquals(lang, { type: "literal", value: "aXc", lang: "en" });
  const nonString = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(REPLACE(5, "5", "X") AS ?v) }`,
    "v",
  );
  assertEquals(nonString, null);
});

Deno.test("WazooSparqlEngine - STRBEFORE/STRAFTER preserve language and empty when absent", async () => {
  const engine = emptyEngine();
  const before = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRBEFORE("abc"@en, "b") AS ?v) }`,
    "v",
  );
  assertEquals(before, { type: "literal", value: "a", lang: "en" });
  const after = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRAFTER("abc", "z") AS ?v) }`,
    "v",
  );
  assertEquals(after, { type: "literal", value: "" });
});

Deno.test("WazooSparqlEngine - LANG and LANGMATCHES", async () => {
  const engine = emptyEngine();
  const lang = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc"@en) AS ?v) }`,
    "v",
  );
  assertEquals(lang, { type: "literal", value: "en" });
  const plain = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG("abc") AS ?v) }`,
    "v",
  );
  assertEquals(plain, { type: "literal", value: "" });
  const iri = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANG(<http://x>) AS ?v) }`,
    "v",
  );
  assertEquals(iri, null);
  const wildcard = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(LANGMATCHES("", "*") AS ?v) }`,
    "v",
  );
  assertEquals(wildcard, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
});

Deno.test("WazooSparqlEngine - RDF 1.2 directional literal functions", async () => {
  const engine = emptyEngine();
  const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

  // LANGDIR returns the base direction; empty when absent; non-literals error.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "ltr" },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc"@en) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "" },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR("abc") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "" },
  );
  assertEquals(
    await bindValue(
      engine,
      "SELECT ?v WHERE { BIND(LANGDIR(<http://x>) AS ?v) }",
      "v",
    ),
    null,
  );

  // hasLang / hasLangDir are unary term tests.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLang("abc") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLangDir("abc"@en--ltr) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(hasLangDir("abc"@en) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );

  // STRLANGDIR builds an rdf:dirLangString literal; bad args are errors.
  const built = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "en", "ltr") AS ?v) }',
    "v",
  );
  assertEquals(built, { type: "literal", value: "abc", lang: "en" });
  const builtDatatype = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(STRLANGDIR("abc", "ar", "rtl")) AS ?v) }',
    "v",
  );
  assertEquals(builtDatatype, {
    type: "uri",
    value: `${RDF}dirLangString`,
  });
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "en", "LTR") AS ?v) }',
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANGDIR("abc", "", "ltr") AS ?v) }',
      "v",
    ),
    null,
  );

  // STRLANG rejects an empty tag; STRDT rejects the rdf:langString and
  // rdf:dirLangString datatypes.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(STRLANG("abc", "") AS ?v) }',
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(STRDT("abc", <${RDF}langString>) AS ?v) }`,
      "v",
    ),
    null,
  );
  assertEquals(
    await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(STRDT("abc", <${RDF}dirLangString>) AS ?v) }`,
      "v",
    ),
    null,
  );

  // Literal equality in filters includes the direction.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr = "x"@en--ltr AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en = "x"@en--ltr AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr = "x"@en--rtl AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND("x"@en--ltr != "x"@en--rtl AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );

  // String functions preserve the direction.
  const ucaseDir = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(UCASE("abc"@en--ltr)) AS ?v) }',
    "v",
  );
  assertEquals(ucaseDir, { type: "uri", value: `${RDF}dirLangString` });
  const concatDir = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(CONCAT("a"@en--ltr, "b"@en--ltr)) AS ?v) }',
    "v",
  );
  assertEquals(concatDir, { type: "uri", value: `${RDF}dirLangString` });
  const concatMixed = await bindValue(
    engine,
    'SELECT ?v WHERE { BIND(DATATYPE(CONCAT("a"@en--ltr, "b"@en)) AS ?v) }',
    "v",
  );
  assertEquals(concatMixed, { type: "uri", value: `${XSD}string` });

  // LANGMATCHES over a directional literal: LANG strips the direction.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGMATCHES(LANG("x"@en--ltr), "en") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGMATCHES(LANG("x"@en--ltr), "fr") AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
});

Deno.test("WazooSparqlEngine - directional literals match only with same direction", async () => {
  const store = new Store();
  const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  store.addQuad(
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("x", { language: "en", direction: "ltr" }),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  // firstObject runs a SELECT and returns the first row's `o` binding, or
  // null when the query produced no rows (a no-match filter).
  async function firstObject(query: string) {
    const result = await engine.execute({ query });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings[0]?.o ?? null;
  }

  // A directional literal in the query matches the store term with the same
  // direction and only that direction.
  assertEquals(
    await firstObject(
      "SELECT ?o WHERE { <http://example.org/s> <http://example.org/p> ?o " +
        'FILTER(?o = "x"@en--ltr) }',
    ),
    { type: "literal", value: "x", "xml:lang": "en", "its:dir": "ltr" },
  );
  assertEquals(
    await firstObject(
      "SELECT ?o WHERE { <http://example.org/s> <http://example.org/p> ?o " +
        'FILTER(?o = "x"@en--rtl) }',
    ),
    null,
  );
  assertEquals(
    await firstObject(
      "SELECT ?o WHERE { <http://example.org/s> <http://example.org/p> ?o " +
        'FILTER(?o = "x"@en) }',
    ),
    null,
  );
  assertEquals(
    await firstObject(
      `SELECT ?o WHERE { <http://example.org/s> <http://example.org/p> ?o ` +
        `FILTER(DATATYPE(?o) = <${RDF}dirLangString>) }`,
    ),
    { type: "literal", value: "x", "xml:lang": "en", "its:dir": "ltr" },
  );
});

Deno.test("WazooSparqlEngine - results serialize directional literals with its:dir", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("x", { language: "en", direction: "ltr" }),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  // A directional literal in the store round-trips through the SELECT wire
  // format with its base direction (SPARQL 1.2 results JSON `its:dir` key,
  // which the XML format mirrors as an its:dir attribute).
  const direct = await engine.execute({
    query:
      "SELECT ?o WHERE { <http://example.org/s> <http://example.org/p> ?o }",
  });
  if (direct.kind !== "select") {
    throw new Error(`expected select, got ${direct.kind}`);
  }
  assertEquals(direct.data.results.bindings[0].o, {
    type: "literal",
    value: "x",
    "xml:lang": "en",
    "its:dir": "ltr",
  });

  // The direction also round-trips nested inside a triple term result.
  const triple = await engine.execute({
    query:
      'SELECT ?t WHERE { BIND(TRIPLE(<http://s>, <http://p>, "x"@en--ltr) AS ?t) }',
  });
  if (triple.kind !== "select") {
    throw new Error(`expected select, got ${triple.kind}`);
  }
  assertEquals(triple.data.results.bindings[0].t, {
    type: "triple",
    value: {
      subject: { type: "uri", value: "http://s" },
      predicate: { type: "uri", value: "http://p" },
      object: {
        type: "literal",
        value: "x",
        "xml:lang": "en",
        "its:dir": "ltr",
      },
    },
  });

  // A plain lang-tagged literal carries no direction key.
  const plain = await engine.execute({
    query: 'SELECT ?o WHERE { BIND("y"@en AS ?o) }',
  });
  if (plain.kind !== "select") {
    throw new Error(`expected select, got ${plain.kind}`);
  }
  assertEquals(plain.data.results.bindings[0].o, {
    type: "literal",
    value: "y",
    "xml:lang": "en",
  });
});

Deno.test("WazooSparqlEngine - TRIPLE/SUBJECT/OBJECT preserve the direction", async () => {
  const engine = emptyEngine();

  // OBJECT of a triple term keeps the directional literal intact, so it
  // round-trips with its direction and compares direction-sensitively.
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(OBJECT(TRIPLE(<http://s>, <http://p>, "x"@en--ltr)) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "x", lang: "en" },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(OBJECT(TRIPLE(<http://s>, <http://p>, "x"@en--ltr)) = "x"@en--ltr AS ?v) }',
      "v",
    ),
    { type: "literal", value: "true", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(OBJECT(TRIPLE(<http://s>, <http://p>, "x"@en--ltr)) = "x"@en AS ?v) }',
      "v",
    ),
    { type: "literal", value: "false", datatype: `${XSD}boolean` },
  );
  assertEquals(
    await bindValue(
      engine,
      'SELECT ?v WHERE { BIND(LANGDIR(OBJECT(TRIPLE(<http://s>, <http://p>, "x"@en--rtl))) AS ?v) }',
      "v",
    ),
    { type: "literal", value: "rtl" },
  );
});

Deno.test("WazooSparqlEngine - ORDER BY orders directional literals deterministically", async () => {
  const store = new Store();
  // Same lexical form, three direction variants: the datatype rdf:dirLangString
  // sorts before rdf:langString, and within it the direction breaks the tie
  // ("" < "ltr" < "rtl" codepoint-wise), so ASC is en--ltr, en--rtl, en.
  store.addQuad(
    quad(
      namedNode("http://example.org/a"),
      namedNode("http://example.org/p"),
      literal("x", { language: "en", direction: "rtl" }),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/b"),
      namedNode("http://example.org/p"),
      literal("x", { language: "en", direction: "ltr" }),
    ),
  );
  store.addQuad(
    quad(
      namedNode("http://example.org/c"),
      namedNode("http://example.org/p"),
      literal("x", "en"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });

  async function orderedObjects(order: string): Promise<string[]> {
    const result = await engine.execute({
      query:
        `SELECT ?o WHERE { ?s <http://example.org/p> ?o } ORDER BY ${order}`,
    });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings.map((b) => {
      const o = b.o as { value: string; "its:dir"?: string };
      return `${o.value}@${o["its:dir"] ?? ""}`;
    });
  }

  assertEquals(await orderedObjects("ASC(?o)"), ["x@ltr", "x@rtl", "x@"]);
  assertEquals(await orderedObjects("DESC(?o)"), ["x@", "x@rtl", "x@ltr"]);
});

Deno.test("WazooSparqlEngine - property paths inside EXISTS evaluate like the main pattern", async () => {
  // Default graph: a -p-> b -q-> c -q-> d, plus a labeled edge b -r-> c.
  // Named graph g1 carries a -p-> b -q-> c (same nodes).
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (
    s: string,
    p: string,
    o: string,
    graph?: string,
  ) => store.addQuad(quad(ex(s), ex(p), ex(o), graph ? ex(graph) : undefined));
  add("a", "p", "b");
  add("b", "q", "c");
  add("c", "q", "d");
  add("b", "r", "c");
  add("a", "p", "b", "g1");
  add("b", "q", "c", "g1");
  const engine = new WazooSparqlEngine({ store });

  async function projected(query: string, variable: string): Promise<string[]> {
    const result = await engine.execute({ query });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings.map((b) =>
      String((b[variable] as { value: string }).value)
    ).sort();
  }

  // EXISTS: b reaches c and d via q+ (one or more q edges), so a passes.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>+ ?z } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // zero-or-more also admits b itself (reflexive), so EXISTS holds.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>* ?z } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // NOT EXISTS with a zero-or-one path: b -q-> c exists, so b is excluded.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER NOT EXISTS { ?o <http://example.org/q>? ?z } }",
      "s",
    ),
    [],
  );
  // Sequence: b -q-> c -q-> d, so EXISTS { ?o <q>/<q> ?z } holds.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>/<http://example.org/q> ?z } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // Alternative: b -r-> c, so (q|r) matches.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o (<http://example.org/q>|<http://example.org/r>) ?z } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // Inverse: nothing points at b via q (c does via b, d via c), so no pass.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o ^<http://example.org/q> ?x } }",
      "s",
    ),
    [],
  );
  // Negated property set: b has a q edge and an r edge; excluding q still
  // matches r, so EXISTS holds.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o !(<http://example.org/q>) ?z } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // Negated property set excluding both q and r leaves b with no edges.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o !(<http://example.org/q>|<http://example.org/r>) ?z } }",
      "s",
    ),
    [],
  );
  // Correlated: the outer binding of ?o is visible inside the path pattern's
  // subject, and the path binds both endpoints.
  assertEquals(
    await projected(
      "SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?s <http://example.org/p>+ ?x } }",
      "s",
    ),
    ["http://example.org/a"],
  );
});

Deno.test("WazooSparqlEngine - property paths inside EXISTS respect GRAPH scopes", async () => {
  // Named graph g1: a -p-> b -q-> c. Default graph also carries a -p-> b and
  // b -q-> c -q-> d, so a plain default-graph EXISTS would pass for q+ even
  // when the GRAPH-scoped one must not (the scope only reaches c).
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string, graph?: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o), graph ? ex(graph) : undefined));
  add("a", "p", "b");
  add("b", "q", "c");
  add("c", "q", "d");
  add("a", "p", "b", "g1");
  add("b", "q", "c", "g1");
  const engine = new WazooSparqlEngine({ store });

  async function projected(query: string, variable: string): Promise<string[]> {
    const result = await engine.execute({ query });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings.map((b) =>
      String((b[variable] as { value: string }).value)
    ).sort();
  }

  // Inside the g1 scope, q+ reaches only c (no d), but the EXISTS still holds
  // for a — the scope is respected, not leaked into the default graph.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH <http://example.org/g1> { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>+ ?z } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // A scope with no q edges at all: EXISTS fails inside it, so a is not
  // emitted even though the default graph would satisfy the path.
  store.addQuad(quad(ex("a"), ex("p"), ex("b"), ex("g2")));
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH <http://example.org/g2> { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>+ ?z } } }",
      "s",
    ),
    [],
  );
  // GRAPH ?g with a bound ?g enumerates the named graphs; only g1 satisfies
  // the q+ EXISTS, so a (from g1) is the sole row.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH ?g { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q>+ ?z } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
});

Deno.test("WazooSparqlEngine - OPTIONAL, MINUS, UNION inside EXISTS reuse the join algebra", async () => {
  // Default graph: a -p-> b -q-> c -q-> d, b -r-> c, and a -p-> e (e has no q
  // or r edges). Named graph g1: a -p-> b -q-> c; g2: a -p-> b (no q).
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string, graph?: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o), graph ? ex(graph) : undefined));
  add("a", "p", "b");
  add("b", "q", "c");
  add("c", "q", "d");
  add("b", "r", "c");
  add("a", "p", "e");
  add("a", "p", "b", "g1");
  add("b", "q", "c", "g1");
  add("a", "p", "b", "g2");
  const engine = new WazooSparqlEngine({ store });

  async function projected(query: string, variable: string): Promise<string[]> {
    const result = await engine.execute({ query });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings.map((b) =>
      String((b[variable] as { value: string }).value)
    ).sort();
  }

  // MINUS: for o=b, z=c is excluded only when the minus side matches c
  // (c -r-> ?w exists); excluding r keeps c, so a passes.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q> ?z MINUS { ?z <http://example.org/r> ?w } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // MINUS excluding q removes z=c entirely, so no o satisfies the EXISTS.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q> ?z MINUS { ?z <http://example.org/q> ?w } } }",
      "s",
    ),
    [],
  );
  // UNION: b connects via q and r, so the union matches; e connects via
  // neither, so only a passes.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { { ?o <http://example.org/q> ?z } UNION { ?o <http://example.org/r> ?z } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // A UNION branch may reference the outer solution's variables directly.
  const both = await engine.execute({
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
      "FILTER EXISTS { { ?o <http://example.org/q> ?z } UNION { ?s <http://example.org/p> ?x } } }",
  });
  if (both.kind !== "select") throw new Error("expected select");
  assertEquals(both.data.results.bindings.length, 2);
  // OPTIONAL: the hoisted group filter (?w = d) is evaluated against the
  // merged binding, so the group still yields z=c and EXISTS holds.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q> ?z OPTIONAL { ?z <http://example.org/q> ?w FILTER(?w = <http://example.org/d>) } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // NOT EXISTS + OPTIONAL: the optional never empties the group, so b fails
  // the negation (its q edge makes the group non-empty), while the leaf e —
  // whose q pattern matches nothing — survives it. a passes via e.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER NOT EXISTS { ?o <http://example.org/q> ?z OPTIONAL { ?z <http://example.org/q> ?w } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // Nested groups recurse: { { q } UNION { r } } inside the EXISTS body.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q> ?z { { ?z <http://example.org/q> ?w } UNION { ?z <http://example.org/r> ?w } } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  // GRAPH scope: in g1 the MINUS-excluding-r form still passes (b -q-> c and
  // c has no r edge in g1), and the UNION matches; in g2 (no q) neither does.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH <http://example.org/g1> { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?o <http://example.org/q> ?z MINUS { ?z <http://example.org/r> ?w } } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH <http://example.org/g2> { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { { ?o <http://example.org/q> ?z } UNION { ?o <http://example.org/r> ?z } } } }",
      "s",
    ),
    [],
  );
  // GRAPH ?g enumerates named graphs; only g1 satisfies the UNION.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { GRAPH ?g { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { { ?o <http://example.org/q> ?z } UNION { ?o <http://example.org/r> ?z } } } }",
      "s",
    ),
    ["http://example.org/a"],
  );
});

Deno.test("WazooSparqlEngine - COALESCE, IF, IN, NOT IN, SAMETERM", async () => {
  const engine = emptyEngine();
  const coalesce = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(COALESCE(?missing, 1/0, "x") AS ?v) }`,
    "v",
  );
  assertEquals(coalesce, { type: "literal", value: "x" });
  const ifFalse = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(IF(false, 1, 2) AS ?v) }`,
    "v",
  );
  assertEquals(ifFalse, {
    type: "literal",
    value: "2",
    datatype: `${XSD}integer`,
  });
  const inErr = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 IN (2, ?missing) AS ?v) }`,
    "v",
  );
  assertEquals(inErr, null);
  const inErrHit = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 IN (1, ?missing) AS ?v) }`,
    "v",
  );
  assertEquals(inErrHit, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const notin = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 NOT IN () AS ?v) }`,
    "v",
  );
  assertEquals(notin, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const same = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SAMETERM(1, "1") AS ?v) }`,
    "v",
  );
  assertEquals(same, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
});

Deno.test("WazooSparqlEngine - BNODE mints fresh and labeled blank nodes", async () => {
  const engine = emptyEngine();
  const fresh = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE() AS ?a) BIND(BNODE() AS ?b) }`,
    "a",
  );
  const freshB = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE() AS ?a) BIND(BNODE() AS ?b) }`,
    "b",
  );
  assertEquals(fresh?.type, "bnode");
  assertEquals(freshB?.type, "bnode");
  // Zero-argument BNODE mints a fresh node per call.
  if (fresh !== null && freshB !== null) {
    if (fresh.value === freshB.value) {
      throw new Error("BNODE() must mint a fresh node per call");
    }
  }
  // BNODE("x") with the same label yields the same node within a query.
  const labeled = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE("x") AS ?a) BIND(BNODE("x") AS ?b) }`,
    "a",
  );
  const labeledB = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE("x") AS ?a) BIND(BNODE("x") AS ?b) }`,
    "b",
  );
  assertEquals(labeled?.type, "bnode");
  assertEquals(labeled?.value, labeledB?.value);
});

Deno.test("WazooSparqlEngine - ABS, CEIL, FLOOR, ROUND preserve the datatype", async () => {
  const engine = emptyEngine();
  const absInt = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ABS(-2) AS ?v) }`,
    "v",
  );
  assertEquals(absInt, {
    type: "literal",
    value: "2",
    datatype: `${XSD}integer`,
  });
  const absDec = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ABS(-2.5) AS ?v) }`,
    "v",
  );
  assertEquals(absDec, {
    type: "literal",
    value: "2.5",
    datatype: `${XSD}decimal`,
  });
  const ceil = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(CEIL(2.5) AS ?v) }`,
    "v",
  );
  assertEquals(ceil, {
    type: "literal",
    value: "3",
    datatype: `${XSD}decimal`,
  });
  const roundNeg = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ROUND(-2.5) AS ?v) }`,
    "v",
  );
  assertEquals(roundNeg, {
    type: "literal",
    value: "-2",
    datatype: `${XSD}decimal`,
  });
  const roundDouble = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ROUND(2.5e0) AS ?v) }`,
    "v",
  );
  assertEquals(roundDouble, {
    type: "literal",
    value: "3.0E0",
    datatype: `${XSD}double`,
  });
});

Deno.test("WazooSparqlEngine - date functions over xsd:dateTime", async () => {
  const engine = emptyEngine();
  const dt = `"2011-01-10T14:45:13.815-05:00"^^<${XSD}dateTime>`;
  const year = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(YEAR(${dt}) AS ?v) }`,
    "v",
  );
  assertEquals(year, {
    type: "literal",
    value: "2011",
    datatype: `${XSD}integer`,
  });
  const seconds = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SECONDS(${dt}) AS ?v) }`,
    "v",
  );
  assertEquals(seconds, {
    type: "literal",
    value: "13.815",
    datatype: `${XSD}decimal`,
  });
  const tz = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(TIMEZONE(${dt}) AS ?v) }`,
    "v",
  );
  assertEquals(tz, {
    type: "literal",
    value: "-PT5H",
    datatype: `${XSD}dayTimeDuration`,
  });
  // A literal without a timezone is an error (unbound).
  const none = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(TIMEZONE("2011-01-10T14:45:13"^^<${XSD}dateTime>) AS ?v) }`,
    "v",
  );
  assertEquals(none, null);
  // A plain string is not an xsd:dateTime.
  const plain = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(YEAR("2011-01-10T14:45:13") AS ?v) }`,
    "v",
  );
  assertEquals(plain, null);
});

Deno.test("WazooSparqlEngine - MD5 and SHA digests", async () => {
  const engine = emptyEngine();
  const checks: Array<[string, string]> = [
    ["MD5", "900150983cd24fb0d6963f7d28e17f72"],
    ["SHA1", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    [
      "SHA256",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      "SHA384",
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    ],
    [
      "SHA512",
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    ],
  ];
  for (const [fn, digest] of checks) {
    const value = await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(${fn}("abc") AS ?v) }`,
      "v",
    );
    assertEquals(value, { type: "literal", value: digest });
  }
});

Deno.test("WazooSparqlEngine - RDF-star expression functions", async () => {
  const engine = emptyEngine();
  const triple = await bindValue(
    engine,
    `SELECT ?t WHERE { BIND(TRIPLE(<http://s>, <http://p>, "o") AS ?t) }`,
    "t",
  );
  assertEquals(triple?.type, "triple");
  const subject = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SUBJECT(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assertEquals(subject, { type: "uri", value: "http://s" });
  const object = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(OBJECT(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assertEquals(object, { type: "literal", value: "o" });
  const isTriple = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(isTRIPLE(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assertEquals(isTriple, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const notTriple = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(isTRIPLE("x") AS ?v) }`,
    "v",
  );
  assertEquals(notTriple, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
  const err = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SUBJECT("x") AS ?v) }`,
    "v",
  );
  assertEquals(err, null);
});

Deno.test("WazooSparqlEngine - RAND, STRUUID, UUID, NOW have the right shape", async () => {
  const engine = emptyEngine();
  const rand = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(RAND() AS ?v) }`,
    "v",
  );
  assertEquals(rand?.type, "literal");
  assertEquals(rand?.datatype, `${XSD}double`);
  if (rand !== null) {
    const value = Number(rand.value);
    if (!(value >= 0 && value < 1)) {
      throw new Error(`RAND out of range: ${value}`);
    }
  }
  const struuid = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(STRUUID() AS ?v) }`,
    "v",
  );
  assertEquals(struuid?.type, "literal");
  if (struuid !== null) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        struuid.value,
      )
    ) {
      throw new Error(`STRUUID not a UUID: ${struuid.value}`);
    }
  }
  const uuid = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(UUID() AS ?v) }`,
    "v",
  );
  assertEquals(uuid?.type, "uri");
  if (uuid !== null && !uuid.value.startsWith("urn:uuid:")) {
    throw new Error(`UUID not urn:uuid: ${uuid.value}`);
  }
  const now = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(NOW() AS ?v) }`,
    "v",
  );
  assertEquals(now?.type, "literal");
  assertEquals(now?.datatype, `${XSD}dateTime`);
});

Deno.test("WazooSparqlEngine - FROM scopes the default graph", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  store.addQuad(quad(ex("a"), ex("p"), literal("d")));
  store.addQuad(quad(ex("a"), ex("p"), literal("1"), ex("g1")));
  store.addQuad(quad(ex("b"), ex("p"), literal("2"), ex("g1")));
  store.addQuad(quad(ex("c"), ex("p"), literal("3"), ex("g2")));
  const engine = new WazooSparqlEngine({ store });

  const fromG1 = await engine.execute({
    query: `SELECT ?s ?o FROM <http://example.org/g1> ` +
      `WHERE { ?s <http://example.org/p> ?o } ORDER BY ?s`,
  });
  assertEquals(fromG1.kind, "select");
  if (fromG1.kind === "select") {
    assertEquals(fromG1.data.results.bindings.length, 2);
    // The store's default-graph quad is invisible under FROM.
    const objects = fromG1.data.results.bindings.map((b) => b.o.value);
    assertEquals(objects, ["1", "2"]);
  }

  const merged = await engine.execute({
    query:
      `SELECT ?s ?o FROM <http://example.org/g1> FROM <http://example.org/g2> ` +
      `WHERE { ?s <http://example.org/p> ?o } ORDER BY ?s`,
  });
  assertEquals(merged.kind, "select");
  if (merged.kind === "select") {
    assertEquals(merged.data.results.bindings.length, 3);
  }

  const missing = await engine.execute({
    query: `SELECT ?s ?o FROM <http://example.org/none> ` +
      `WHERE { ?s <http://example.org/p> ?o }`,
  });
  assertEquals(missing.kind, "select");
  if (missing.kind === "select") {
    assertEquals(missing.data.results.bindings.length, 0);
  }

  const ask = await engine.execute({
    query:
      `ASK FROM <http://example.org/g1> WHERE { ?s <http://example.org/p> ?o }`,
  });
  assertEquals(ask.kind, "ask");
  if (ask.kind === "ask") {
    assertEquals(ask.data.boolean, true);
  }
});

Deno.test("WazooSparqlEngine - FROM NAMED restricts GRAPH enumeration", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  store.addQuad(quad(ex("a"), ex("p"), literal("1"), ex("g1")));
  store.addQuad(quad(ex("c"), ex("p"), literal("3"), ex("g2")));
  const engine = new WazooSparqlEngine({ store });

  const graphs = await engine.execute({
    query: `SELECT ?g FROM NAMED <http://example.org/g1> ` +
      `WHERE { GRAPH ?g { ?s ?p ?o } }`,
  });
  assertEquals(graphs.kind, "select");
  if (graphs.kind === "select") {
    const names = graphs.data.results.bindings.map((b) => b.g.value);
    assertEquals(names, ["http://example.org/g1"]);
  }

  // FROM without FROM NAMED leaves no named graphs.
  const none = await engine.execute({
    query: `SELECT ?g FROM <http://example.org/g1> ` +
      `WHERE { GRAPH ?g { ?s ?p ?o } }`,
  });
  assertEquals(none.kind, "select");
  if (none.kind === "select") {
    assertEquals(none.data.results.bindings.length, 0);
  }
});

Deno.test("WazooSparqlEngine - SERVICE pattern single-endpoint fallback", async () => {
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
      `SELECT ?name WHERE { SERVICE <http://example.org/sparql> { ?person <http://xmlns.com/foaf/0.1/name> ?name } }`,
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(result.data.results.bindings[0].name.value, "Ethan");
  }
});

/** Builds a store with reified triples: :s :p :o reified by :iri with an
 * annotation, and :s :p :o2 reified by a fresh blank node with an annotation. */
function reifiedStore(): Store {
  const store = new Store();
  const s = namedNode("http://example.com/ns#s");
  const p = namedNode("http://example.com/ns#p");
  const o = namedNode("http://example.com/ns#o");
  const o2 = namedNode("http://example.com/ns#o2");
  const iri = namedNode("http://example.com/ns#iri");
  const r = namedNode("http://example.com/ns#r");
  const reifies = namedNode(
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  store.addQuad(quad(s, p, o));
  store.addQuad(quad(iri, reifies, quad(s, p, o)));
  store.addQuad(quad(iri, r, namedNode("http://example.com/ns#Z1")));
  store.addQuad(quad(s, p, o2));
  store.addQuad(quad(blankNode("r2"), reifies, quad(s, p, o2)));
  store.addQuad(
    quad(blankNode("r2"), r, namedNode("http://example.com/ns#Z2")),
  );
  return store;
}

Deno.test("WazooSparqlEngine - reifier and annotation after an object match reified data", async () => {
  const engine = new WazooSparqlEngine({ store: reifiedStore() });
  const result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ :iri {| :r ?Z |} }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
    const b = result.data.results.bindings[0];
    assertEquals(b.o.value, "http://example.com/ns#o");
    assertEquals(b.Z.value, "http://example.com/ns#Z1");
  }
});

Deno.test("WazooSparqlEngine - variable reifier binds the reifier term", async () => {
  const engine = new WazooSparqlEngine({ store: reifiedStore() });
  const result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ ?r {| :r ?Z |} }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 2);
    const byO = new Map(
      result.data.results.bindings.map((b) => [b.o.value, b]),
    );
    assertEquals(
      byO.get("http://example.com/ns#o")!.r.value,
      "http://example.com/ns#iri",
    );
    assertEquals(byO.get("http://example.com/ns#o2")!.r.type, "bnode");
  }
});

Deno.test("WazooSparqlEngine - bare ~ matches any reifier of the triple", async () => {
  const engine = new WazooSparqlEngine({ store: reifiedStore() });
  const result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ {| :r ?Z |} }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 2);
  }
});

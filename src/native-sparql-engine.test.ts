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

Deno.test("NativeSparqlEngine - FILTER numeric comparison and arithmetic", async () => {
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

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - FILTER string, language, STR and STRLEN", async () => {
  const store = new Store();
  const name = (person: string, value: string, language?: string) =>
    quad(
      namedNode(`http://example.org/${person}`),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      language ? literal(value, language) : literal(value),
    );
  store.addQuad(name("alice", "Alice"));
  store.addQuad(name("bob", "Bob"));
  store.addQuad(name("carol", "Carol", "en"));

  const engine = new NativeSparqlEngine({ store });
  const eq = await engine.execute({
    query:
      'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(?name = "Alice") }',
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
      "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(STRLEN(?name) > 4) }",
  });
  assertEquals(strlen.kind, "select");
  if (strlen.kind === "select") {
    assertEquals(
      strlen.data.results.bindings.map((b) => b.person.value),
      ["http://example.org/alice", "http://example.org/carol"],
    );
  }
});

Deno.test("NativeSparqlEngine - FILTER bound(), EBV, and error semantics", async () => {
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
      namedNode("http://example.org/carol"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Carol", "en"),
    ),
  );

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - ORDER BY expression (STRLEN and STR)", async () => {
  const store = new Store();
  const name = (person: string, value: string, language?: string) =>
    quad(
      namedNode(`http://example.org/${person}`),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      language ? literal(value, language) : literal(value),
    );
  store.addQuad(name("alice", "Alice"));
  store.addQuad(name("bob", "Bob"));
  store.addQuad(name("carol", "Carol", "en"));

  const engine = new NativeSparqlEngine({ store });
  const byLen = await engine.execute({
    query:
      "SELECT ?person ?name WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name } ORDER BY DESC(STRLEN(?name))",
  });
  assertEquals(byLen.kind, "select");
  if (byLen.kind === "select") {
    assertEquals(
      byLen.data.results.bindings.map((b) => b.person.value),
      [
        "http://example.org/alice",
        "http://example.org/carol",
        "http://example.org/bob",
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
        "http://example.org/alice",
        "http://example.org/bob",
        "http://example.org/carol",
      ],
    );
  }
});

Deno.test("NativeSparqlEngine - unsupported FILTER expression is rejected", async () => {
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
          'SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name FILTER(STRSTARTS(?name, "A")) }',
      }),
    Error,
    "Unsupported SPARQL expression operator: strstarts",
  );
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
    store.addQuad(
      quad(
        namedNode("http://example.org/bob"),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal("Bob"),
      ),
    );
    const engine = new NativeSparqlEngine({ store });
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
        ["http://example.org/bob", "http://example.org/alice"],
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

Deno.test("NativeSparqlEngine - OPTIONAL extends matches and keeps unmatched unbound", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - OPTIONAL filter drops a join and keeps the solution unextended", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - OPTIONAL filter can reference an outer variable", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - OPTIONAL nests inside OPTIONAL", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("knows"), ex("bob")));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - MINUS eliminates solutions sharing a bound variable", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - MINUS with no shared variables keeps all solutions", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?p WHERE { ?p <http://xmlns.com/foaf/0.1/name> ?n MINUS { ?x <http://xmlns.com/foaf/0.1/age> ?y } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 3);
  }
});

Deno.test("NativeSparqlEngine - MINUS applies its own FILTER inside the group", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - UNION combines branch solutions as a multiset", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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

Deno.test("NativeSparqlEngine - UNION branches can bind different variables", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?n ?a WHERE { { ?s <http://xmlns.com/foaf/0.1/name> ?n } UNION { ?s <http://xmlns.com/foaf/0.1/age> ?a } }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const bindings = result.data.results.bindings;
    assertEquals(bindings.length, 2);
    assertEquals(bindings[0].n?.value, "Alice");
    assertEquals(bindings[0].a, undefined);
    assertEquals(bindings[1].n, undefined);
    assertEquals(bindings[1].a?.value, "28");
  }
});

Deno.test("NativeSparqlEngine - UNION in a sequence joins with preceding patterns", async () => {
  const store = new Store();
  const ex = (s: string) => namedNode(`http://example.org/${s}`);
  const foaf = (s: string) => namedNode(`http://xmlns.com/foaf/0.1/${s}`);
  const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");
  store.addQuad(quad(ex("alice"), foaf("name"), literal("Alice")));
  store.addQuad(quad(ex("alice"), foaf("age"), literal("28", xsdInteger)));
  store.addQuad(quad(ex("bob"), foaf("name"), literal("Bob")));
  store.addQuad(quad(ex("carol"), foaf("name"), literal("Carol")));
  store.addQuad(quad(ex("carol"), foaf("age"), literal("30", xsdInteger)));

  const engine = new NativeSparqlEngine({ store });
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
      ["http://example.org/alice", "Alice", undefined],
      ["http://example.org/alice", "Alice", "28"],
      ["http://example.org/bob", "Bob", undefined],
      ["http://example.org/carol", "Carol", undefined],
      ["http://example.org/carol", "Carol", "30"],
    ]);
  }
});

Deno.test("NativeSparqlEngine - unsupported GRAPH pattern is rejected", async () => {
  const store = new Store();
  const engine = new NativeSparqlEngine({ store });
  await assertRejects(
    () =>
      engine.execute({
        query:
          "SELECT ?s WHERE { GRAPH <http://example.org/g> { ?s <http://xmlns.com/foaf/0.1/name> ?n } }",
      }),
    Error,
    "Unsupported graph pattern type: graph",
  );
});

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

Deno.test("NativeSparqlEngine - UCASE and LCASE preserve language tags", async () => {
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
      namedNode("http://example.org/carol"),
      namedNode("http://xmlns.com/foaf/0.1/name"),
      literal("Carol", "en"),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

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
    assertEquals(alice?.upper, { type: "literal", value: "ALICE" });
    assertEquals(alice?.lower, { type: "literal", value: "alice" });
    const carol = byPerson.get("http://example.org/carol");
    assertEquals(carol?.upper, {
      type: "literal",
      value: "CAROL",
      "xml:lang": "en",
    });
  }
});

Deno.test("NativeSparqlEngine - SUBSTR clips positions before 1 and handles length", async () => {
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
      "SELECT (SUBSTR(?name, 2, 3) AS ?mid) (SUBSTR(?name, 0, 2) AS ?clipped) " +
      "(SUBSTR(?name, 2, 0) AS ?empty) " +
      "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
  });

  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const b = result.data.results.bindings[0];
    assertEquals(b.mid.value, "lic");
    assertEquals(b.clipped.value, "A");
    assertEquals(b.empty.value, "");
  }
});

Deno.test("NativeSparqlEngine - CONCAT type error leaves the projection unbound", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/alice"),
      namedNode("http://xmlns.com/foaf/0.1/age"),
      literal("28", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  );
  const engine = new NativeSparqlEngine({ store });

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

Deno.test("NativeSparqlEngine - XSD value constructors produce canonical forms", async () => {
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

Deno.test("NativeSparqlEngine - STRDT and STRLANG re-tag literals", async () => {
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

Deno.test("NativeSparqlEngine - unknown function call raises a clear error", async () => {
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
        query: "SELECT (<http://example.org/custom>(?name) AS ?c) " +
          "WHERE { <http://example.org/alice> <http://xmlns.com/foaf/0.1/name> ?name }",
      }),
    Error,
    "Unsupported SPARQL expression: functionCall",
  );
});

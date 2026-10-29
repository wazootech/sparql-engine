import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

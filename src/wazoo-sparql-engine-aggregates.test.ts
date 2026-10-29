import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  aggregateEngine,
  aggregateRows,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

Deno.test("WazooSparqlEngine - ORDER BY a SELECT aggregate alias orders the groups", async () => {
  // Regression for issue #201: a bare reference to a SELECT aggregate alias
  // (?c) must sort by the projected value per SPARQL 1.1 — the alias is
  // bound by the projection-conversion Extend (§18.2.4.4) before the ORDER
  // BY solution modifier runs (§18.2.5.1). The lower-count group is
  // inserted first, so a no-op sort leaves it in front and fails.
  const store = new Store();
  const count = (subject: string, values: string[]) => {
    for (const value of values) {
      store.addQuad(
        quad(
          namedNode(`http://example.org/${subject}`),
          namedNode("http://example.org/p"),
          literal(value, namedNode("http://www.w3.org/2001/XMLSchema#integer")),
        ),
      );
    }
  };
  count("a", ["1"]);
  count("b", ["1", "2", "3"]);
  const engine = new WazooSparqlEngine({ store });
  assertEquals(
    await aggregateRows(
      engine,
      "SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s <http://example.org/p> ?o } " +
        "GROUP BY ?s ORDER BY DESC(?c) ?s",
    ),
    [
      '{"s":"http://example.org/b","c":"3^^http://www.w3.org/2001/XMLSchema#integer"}',
      '{"s":"http://example.org/a","c":"1^^http://www.w3.org/2001/XMLSchema#integer"}',
    ],
  );
});

Deno.test("WazooSparqlEngine - ORDER BY an aggregate alias separates ties and non-ties", async () => {
  // Issue #201 discriminator: counts {2, 2, 1} under DESC(?n) must yield
  // 2, 2, 1 — the order of the two tied groups is free, but the count-1
  // group must sort after both. The count-1 group is inserted between the
  // two count-2 groups, so the pre-fix engine returned 2, 1, 2: the alias
  // resolved unbound for every group and the stable sort kept
  // group-formation order.
  const store = new Store();
  const typed = (subject: string, type: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${subject}`),
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode(`http://example.org/${type}`),
      ),
    );
  typed("a", "Event");
  typed("b", "Event");
  typed("c", "Person");
  typed("d", "Place");
  typed("e", "Place");
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query:
      "SELECT ?type (COUNT(*) AS ?n) WHERE { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type } " +
      "GROUP BY ?type ORDER BY DESC(?n)",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings.map((b) => (b.n as { value: string }).value),
      ["2", "2", "1"],
    );
  }
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

import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

Deno.test("WazooSparqlEngine - subqueries inside EXISTS evaluate over the graph-scoped snapshot", async () => {
  // Default graph: s -p-> a, t -p-> b, u -p-> c; s and t also have q edges,
  // u does not. This mirrors the cross-engine validation dataset.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o)));
  add("s", "p", "a");
  add("t", "p", "b");
  add("u", "p", "c");
  store.addQuad(quad(ex("s"), ex("q"), literal("x")));
  store.addQuad(quad(ex("t"), ex("q"), literal("y")));
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

  // Basic subquery: EXISTS holds whenever the subquery has any result, so
  // all three subjects pass.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w } } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // NOT EXISTS: the subquery's WHERE matches nothing, so the negation holds
  // for every subject.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER NOT EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w . " +
        "?x <http://example.org/z> ?zz } } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // Aggregates and HAVING run inside the subquery: COUNT = 2 passes the
  // HAVING, so EXISTS holds.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { ?x <http://example.org/q> ?w } " +
        "HAVING (COUNT(?x) >= 2) } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // DISTINCT dedups the subquery's projection.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT DISTINCT ?x WHERE { ?x <http://example.org/q> ?w } } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // Projection expressions evaluate inside the subquery.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT (UCASE(?w) AS ?u) WHERE { ?x <http://example.org/q> ?w " +
        'FILTER (UCASE(?w) = "X") } } }',
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // Subqueries evaluate independently of the enclosing solution (SPARQL 1.1
  // §18.2.4): the inner FILTER referencing the outer ?s is unbound inside
  // the subquery, so the subquery yields nothing and EXISTS is false.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w . " +
        "FILTER(?x = ?s) } } }",
      "s",
    ),
    [],
  );
  // ORDER BY and LIMIT run inside the subquery; the single result keeps
  // EXISTS true.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w } " +
        "ORDER BY DESC(?w) LIMIT 1 } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
});

Deno.test("WazooSparqlEngine - NOT EXISTS and EXISTS nest inside EXISTS subqueries", async () => {
  // Same dataset as the cross-engine gate: s -p-> a, t -p-> b, u -p-> c;
  // s and t have q edges, and s alone has an r edge (ex:s ex:r ex:z).
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o)));
  add("s", "p", "a");
  add("t", "p", "b");
  add("u", "p", "c");
  store.addQuad(quad(ex("s"), ex("q"), literal("x")));
  store.addQuad(quad(ex("t"), ex("q"), literal("y")));
  store.addQuad(quad(ex("s"), ex("r"), ex("z")));
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

  // NOT EXISTS inside the EXISTS subquery correlates with the subquery's own
  // ?x: s has an r edge so it is filtered out, t survives. HAVING pins the
  // surviving count to 1, so EXISTS holds and all three subjects pass. If
  // the nested NOT EXISTS stopped filtering, the count would become 2 and
  // the EXISTS would turn false.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { " +
        "?x <http://example.org/q> ?w . " +
        "FILTER NOT EXISTS { ?x <http://example.org/r> ?z } } " +
        "HAVING (COUNT(?x) = 1) } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
  // EXISTS inside the EXISTS subquery requires an r edge, so only s
  // survives; the HAVING pin keeps EXISTS true. Treating the nested EXISTS
  // as always true would yield count 2 and fail every outer row.
  assertEquals(
    await projected(
      "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
        "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { " +
        "?x <http://example.org/q> ?w . " +
        "FILTER EXISTS { ?x <http://example.org/r> ?z } } " +
        "HAVING (COUNT(?x) = 1) } }",
      "s",
    ),
    ["http://example.org/s", "http://example.org/t", "http://example.org/u"],
  );
});

Deno.test("WazooSparqlEngine - EXISTS snapshot cache sees store mutations between queries", async () => {
  // The EXISTS synchronous snapshot is cached across queries and must be
  // invalidated when the store changes: a query, then a mutation, then the
  // same query again must observe the new data.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  store.addQuad(quad(ex("a"), ex("p"), literal("x")));
  store.addQuad(quad(ex("b"), ex("p"), literal("y")));
  store.addQuad(quad(ex("a"), ex("q"), literal("1")));
  const engine = new WazooSparqlEngine({ store });

  async function projected(variable: string): Promise<string[]> {
    const result = await engine.execute({
      query: "SELECT ?s WHERE { ?s <http://example.org/p> ?o " +
        "FILTER EXISTS { ?s <http://example.org/q> ?z } }",
    });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return result.data.results.bindings.map((b) =>
      String((b[variable] as { value: string }).value)
    ).sort();
  }

  // Only a has a q edge: EXISTS keeps a. A second identical query (cache
  // hit) must return the same result.
  assertEquals(await projected("s"), ["http://example.org/a"]);
  assertEquals(await projected("s"), ["http://example.org/a"]);
  // Mutate the store, then re-run: the cached snapshot must be rebuilt, so
  // b now passes the EXISTS filter too.
  store.addQuad(quad(ex("b"), ex("q"), literal("2")));
  assertEquals(
    await projected("s"),
    ["http://example.org/a", "http://example.org/b"],
  );
});

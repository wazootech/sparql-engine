import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

Deno.test("WazooSparqlEngine - EXISTS in the projection expression evaluates per row", async () => {
  // s has an r edge, t and u do not — the projected EXISTS flag must be true
  // only for s. This is the projection-phase hook the Oxigraph gate also
  // probes (test/w3c/exists-ref.ts); previously only the Comunica parity
  // suite covered this position, with no in-repo unit assertion.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o)));
  add("s", "q", "x");
  add("t", "q", "y");
  add("u", "q", "z");
  add("s", "r", "z");
  const engine = new WazooSparqlEngine({ store });

  const result = await engine.execute({
    query: "SELECT ?s (EXISTS { ?s <http://example.org/r> ?o } AS ?flag) " +
      "WHERE { ?s <http://example.org/q> ?w }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    const rows = result.data.results.bindings.map((b) => ({
      s: (b.s as { value: string }).value,
      flag: (b.flag as { value: string }).value,
    }));
    assertEquals(rows.sort((a, b) => a.s.localeCompare(b.s)), [
      { s: "http://example.org/s", flag: "true" },
      { s: "http://example.org/t", flag: "false" },
      { s: "http://example.org/u", flag: "false" },
    ]);
  }
});

Deno.test("WazooSparqlEngine - main-path joins never leak named graphs when EXISTS is present", async () => {
  // s lives in the default graph AND named graph g1; t lives only in g1.
  // With EXISTS present the main path could reuse the all-graph snapshot
  // index — the guard in existsIndexForScope must fall back to the scoped
  // build so g1's quads stay invisible in the default-scope answer.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string, graph?: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o), graph ? ex(graph) : undefined));
  add("s", "name", "S");
  add("s", "p1", "o1");
  add("s", "p", "v1");
  add("s", "p1", "o2", "g1");
  add("s", "p", "v2", "g1");
  add("t", "name", "T", "g1");
  add("t", "p1", "o3", "g1");
  add("t", "p", "v3", "g1");
  const engine = new WazooSparqlEngine({ store });

  // ?s p1 ?o joins against a bound ?s, so it would reuse the prebuilt index;
  // the default-scope answer must contain only s's default-graph p1 quads.
  const result = await engine.execute({
    query: "SELECT ?s ?o WHERE { ?s <http://example.org/name> ?n " +
      ". ?s <http://example.org/p1> ?o " +
      "FILTER EXISTS { ?s <http://example.org/p> ?v } }",
  });
  if (result.kind !== "select") {
    throw new Error(`expected select, got ${result.kind}`);
  }
  const rows = result.data.results.bindings.map((b) => [
    String((b.s as { value: string }).value),
    String((b.o as { value: string }).value),
  ]).sort();
  assertEquals(rows, [
    ["http://example.org/s", "http://example.org/o1"],
  ]);
});

Deno.test("WazooSparqlEngine - concurrent execute() calls are isolated from each other", async () => {
  // One engine over one static store: concurrent EXISTS queries must return
  // the same results as sequential execution (issue #72) — each call
  // captures its own snapshot, so a concurrent call can never swap the
  // EXISTS index mid-evaluation.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  for (let i = 0; i < 200; i++) {
    const s = namedNode(`http://example.org/s${i}`);
    store.addQuad(quad(s, ex("name"), literal(`Name ${i}`)));
    if (i % 2 === 0) {
      store.addQuad(
        quad(
          s,
          ex("spouse"),
          namedNode(`http://example.org/s${(i + 1) % 200}`),
        ),
      );
    }
  }
  const engine = new WazooSparqlEngine({ store });

  const queries = [
    "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
    "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse } }",
    "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
    "FILTER NOT EXISTS { ?s <http://example.org/spouse> ?spouse } }",
    "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
    "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse . " +
    "FILTER EXISTS { ?spouse <http://example.org/name> ?n2 } } }",
    "SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s <http://example.org/name> ?n " +
    "OPTIONAL { ?s <http://example.org/spouse> ?spouse . " +
    "FILTER EXISTS { ?spouse <http://example.org/name> ?n2 } } } " +
    "GROUP BY ?s",
  ];

  async function resultOf(query: string): Promise<string> {
    const result = await engine.execute({ query });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    return JSON.stringify(
      result.data.results.bindings.map((binding) => {
        const record: Record<string, unknown> = {};
        for (const name of Object.keys(binding)) {
          record[name] = binding[name];
        }
        return record;
      }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
    );
  }

  const sequential = new Map<string, string>();
  for (const query of queries) {
    sequential.set(query, await resultOf(query));
  }

  for (let round = 0; round < 6; round++) {
    const shuffled = [...queries].sort(() => Math.random() - 0.5);
    const concurrent = await Promise.all(shuffled.map(resultOf));
    for (let i = 0; i < concurrent.length; i++) {
      assertEquals(
        concurrent[i],
        sequential.get(shuffled[i]),
        `round ${round}: concurrent result diverged from sequential`,
      );
    }
  }
});

Deno.test("WazooSparqlEngine - concurrent updates never corrupt in-flight EXISTS evaluation", async () => {
  // A self-restoring update interleaved with EXISTS queries: the store
  // version churns, so the shared snapshot cache is rebuilt while queries
  // are mid-flight. No query may error — each call uses its own captured
  // snapshot — even though the mutation makes exact results undefined.
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  for (let i = 0; i < 200; i++) {
    const s = namedNode(`http://example.org/s${i}`);
    store.addQuad(quad(s, ex("name"), literal(`Name ${i}`)));
    if (i % 2 === 0) {
      store.addQuad(
        quad(
          s,
          ex("spouse"),
          namedNode(`http://example.org/s${(i + 1) % 200}`),
        ),
      );
    }
  }
  const engine = new WazooSparqlEngine({ store });

  const existsQuery = "SELECT ?s WHERE { ?s <http://example.org/name> ?n " +
    "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse } }";
  const rewrite = "DELETE { ?s <http://example.org/spouse> ?spouse } " +
    "INSERT { ?s <http://example.org/spouse> ?spouse } " +
    "WHERE { ?s <http://example.org/spouse> ?spouse }";

  for (let round = 0; round < 5; round++) {
    const results = await Promise.all([
      engine.execute({ query: rewrite }),
      engine.execute({ query: existsQuery }),
      engine.execute({ query: existsQuery }),
    ]);
    for (const result of results) {
      if (result.kind !== "select" && result.kind !== "void") {
        throw new Error(`unexpected kind ${result.kind}`);
      }
    }
  }
});

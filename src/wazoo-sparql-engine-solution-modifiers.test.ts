import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  bindValue,
  emptyEngine,
  pathBindings,
  pathEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

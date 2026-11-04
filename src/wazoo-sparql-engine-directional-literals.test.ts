import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  bindValue,
  emptyEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

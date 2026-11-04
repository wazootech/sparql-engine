import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  bindValue,
  emptyEngine,
  hangingStore,
  reifiedStore,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import { assertEquals, assertRejects } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

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

Deno.test("WazooSparqlEngine - request baseIri resolves relative IRI() when no BASE directive", async () => {
  const engine = new WazooSparqlEngine({ store: new Store() });
  const result = await engine.execute({
    query: `SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`,
    baseIri: "http://example.org/root/",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings[0].iri.value,
      "http://example.org/root/rel/path",
    );
  }
});

Deno.test("WazooSparqlEngine - the query's BASE directive wins over request baseIri", async () => {
  const engine = new WazooSparqlEngine({ store: new Store() });
  const result = await engine.execute({
    query: `BASE <http://directive.example/>
SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`,
    baseIri: "http://request.example/",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(
      result.data.results.bindings[0].iri.value,
      "http://directive.example/rel/path",
    );
  }
});

Deno.test("WazooSparqlEngine - query cache distinguishes baseIri", async () => {
  // The parse depends on the base (query.base and prefix resolution), so the
  // same query string with different request bases must not share a cache
  // entry (issue #117).
  const engine = new WazooSparqlEngine({ store: new Store() });
  const query = `SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`;
  const first = await engine.execute({
    query,
    baseIri: "http://first.example/",
  });
  const second = await engine.execute({
    query,
    baseIri: "http://second.example/",
  });
  assertEquals(first.kind, "select");
  assertEquals(second.kind, "select");
  if (first.kind === "select" && second.kind === "select") {
    assertEquals(
      first.data.results.bindings[0].iri.value,
      "http://first.example/rel/path",
    );
    assertEquals(
      second.data.results.bindings[0].iri.value,
      "http://second.example/rel/path",
    );
  }
});

Deno.test("WazooSparqlEngine - relative LOAD source resolves against request baseIri", async () => {
  const dir = await Deno.makeTempDir();
  const turtlePath = `${dir}/data.ttl`;
  await Deno.writeTextFile(
    turtlePath,
    "<http://example.org/s> <p> <http://example.org/o> .\n",
  );
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "LOAD <data.ttl>",
    baseIri: new URL(`file:///${dir.replace(/\\/g, "/")}/`).href,
  });
  assertEquals(result.kind, "void");
  const loaded = store.getQuads(null, null, null, null);
  assertEquals(loaded.length, 1);
  assertEquals(loaded[0].subject.value, "http://example.org/s");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("WazooSparqlEngine - timeoutMs rejects with Comunica's message", async () => {
  const engine = new WazooSparqlEngine({ store: hangingStore() });
  await assertRejects(
    () =>
      engine.execute({
        query: "SELECT ?s WHERE { ?s ?p ?o }",
        timeoutMs: 20,
      }),
    Error,
    "SPARQL query timed out",
  );
});

Deno.test("WazooSparqlEngine - caller signal aborts a hanging request", async () => {
  const engine = new WazooSparqlEngine({ store: hangingStore() });
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("caller cancelled")), 20);
  await assertRejects(
    () =>
      engine.execute({
        query: "SELECT ?s WHERE { ?s ?p ?o }",
        signal: controller.signal,
      }),
    Error,
    "caller cancelled",
  );
});

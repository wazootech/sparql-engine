import { assertEquals } from "@std/assert";
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

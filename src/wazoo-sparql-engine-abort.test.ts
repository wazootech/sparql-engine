import { DataFactory } from "@/term/mod.ts";
import { SparqlEvaluator } from "@/evaluator/sparql-evaluator.ts";
import { SparqlParser } from "@/parser/sparql-parser.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals, assertRejects } from "@std/assert";

const { namedNode, literal, quad } = DataFactory;

Deno.test("WazooSparqlEngine - pre-aborted signal rejects immediately", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("o"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const controller = new AbortController();
  controller.abort(new Error("aborted before start"));
  await assertRejects(
    () =>
      engine.execute({
        query: "SELECT ?s WHERE { ?s ?p ?o }",
        signal: controller.signal,
      }),
    Error,
    "aborted before start",
  );
});

Deno.test("WazooSparqlEngine - pre-aborted signal rejects updates too", async () => {
  const engine = new WazooSparqlEngine({ store: new Store() });
  const controller = new AbortController();
  controller.abort(new Error("aborted update"));
  await assertRejects(
    () =>
      engine.execute({
        query:
          "INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }",
        signal: controller.signal,
      }),
    Error,
    "aborted update",
  );
});

Deno.test("WazooSparqlEngine - boundary check aborts evaluation without the race", async () => {
  // No execute() race here: the rejection can only come from the per-boundary
  // checkAborted at evaluateBgp entry (the signal is threaded through the
  // evaluator, issue #122 scope 2).
  const evaluator = new SparqlEvaluator(new Store());
  const query = new SparqlParser().parse("SELECT ?s WHERE { ?s ?p ?o }");
  const controller = new AbortController();
  controller.abort(new Error("stop at boundary"));
  await assertRejects(
    () => evaluator.evaluateQuery(query, controller.signal),
    Error,
    "stop at boundary",
  );
});

Deno.test("WazooSparqlEngine - timeoutMs on a fast query still succeeds", async () => {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("o"),
    ),
  );
  const engine = new WazooSparqlEngine({ store });
  const result = await engine.execute({
    query: "SELECT ?s WHERE { ?s ?p ?o }",
    timeoutMs: 5_000,
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
  }
});

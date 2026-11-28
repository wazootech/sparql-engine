import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

test("COUNT and SAMPLE ignore an expression that fails", async () => {
  const result = await new WazooSparqlEngine({
    store: new MemoryStore(),
  }).execute({
    query:
      "SELECT (COUNT(1 / ?n) AS ?count) (SAMPLE(1 / ?n) AS ?sample) " +
      "WHERE { VALUES ?n { 0 2 } }",
  });
  assert.ok(result.kind === "select");
  const row = result.data.results.bindings[0]!;
  assert.strictEqual(String(row.count?.value), "1");
  assert.strictEqual(String(row.sample?.value), "0.5");
});

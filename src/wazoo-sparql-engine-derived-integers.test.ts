import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "@/store/memory-store.ts";
import { DataFactory } from "@/term/public.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { literal, namedNode, quad } = DataFactory;
const xsd = "http://www.w3.org/2001/XMLSchema#";

/** firstRow runs a SELECT over two stored xsd:int values, 10 and 9. */
async function firstRow(query: string): Promise<Record<string, string>> {
  const store = new MemoryStore();
  for (const value of ["10", "9"]) {
    store.addQuad(
      quad(
        namedNode(`urn:s${value}`),
        namedNode("urn:v"),
        literal(value, namedNode(`${xsd}int`)),
      ),
    );
  }
  const result = await new WazooSparqlEngine({ store }).execute({ query });
  assert.ok(result.kind === "select");
  const row = result.data.results.bindings[0]!;
  return Object.fromEntries(
    Object.entries(row).map(([name, term]) => [name, String(term.value)]),
  );
}

test("stored xsd:int values order and aggregate by value", async () => {
  assert.deepStrictEqual(
    await firstRow("SELECT ?v WHERE { ?s <urn:v> ?v } ORDER BY ?v LIMIT 1"),
    { v: "9" },
  );
  assert.deepStrictEqual(
    await firstRow(
      "SELECT (MIN(?v) AS ?min) (MAX(?v) AS ?max) (SUM(?v) AS ?sum) " +
        "WHERE { ?s <urn:v> ?v }",
    ),
    { min: "9", max: "10", sum: "19" },
  );
});

test("STR and xsd:string keep integers beyond 2^53 exact", async () => {
  const big = "9223372036854775807";
  assert.deepStrictEqual(
    await firstRow(
      `SELECT (STR("${big}"^^<${xsd}long>) AS ?a) ` +
        `(<${xsd}string>(${big}) AS ?b) WHERE {}`,
    ),
    { a: big, b: big },
  );
});

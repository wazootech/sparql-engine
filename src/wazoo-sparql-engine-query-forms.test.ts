import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "@/store/memory-store.ts";
import { DataFactory } from "@/term/public.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { literal, namedNode, quad } = DataFactory;

/** described returns the subjects DESCRIBE reports over three aged people. */
async function described(query: string): Promise<string[]> {
  const store = new MemoryStore();
  for (const [id, age] of [
    ["a", "30"],
    ["b", "29"],
    ["c", "28"],
  ]) {
    store.addQuad(
      quad(namedNode(`urn:${id}`), namedNode("urn:age"), literal(age!)),
    );
  }
  const result = await new WazooSparqlEngine({ store }).execute({ query });
  assert.ok(result.kind === "construct");
  return result.data.quads.map((item) => item.subject.value).sort();
}

const WHERE = "WHERE { ?s <urn:age> ?age }";

test("DESCRIBE applies ORDER BY, OFFSET and LIMIT to its solutions", async () => {
  assert.deepStrictEqual(
    await described(`DESCRIBE ?s ${WHERE} ORDER BY ?age LIMIT 1`),
    ["urn:c"],
  );
  assert.deepStrictEqual(
    await described(`DESCRIBE ?s ${WHERE} ORDER BY ?age OFFSET 2`),
    ["urn:a"],
  );
  assert.deepStrictEqual(await described(`DESCRIBE ?s ${WHERE} OFFSET 9`), []);
});

test("DESCRIBE joins a trailing VALUES clause", async () => {
  assert.deepStrictEqual(
    await described(`DESCRIBE ?s ${WHERE} VALUES ?s { <urn:b> }`),
    ["urn:b"],
  );
  assert.deepStrictEqual(await described("DESCRIBE ?s VALUES ?s { <urn:a> }"), [
    "urn:a",
  ]);
});

test("DESCRIBE of an IRI needs no solutions", async () => {
  assert.deepStrictEqual(await described("DESCRIBE <urn:a>"), ["urn:a"]);
});

/** run executes a query over one named subject. */
async function run(query: string) {
  const store = new MemoryStore();
  store.addQuad(
    quad(namedNode("urn:a"), namedNode("urn:name"), literal("Ada")),
  );
  return await new WazooSparqlEngine({ store }).execute({ query });
}

test("ASK applies OFFSET and LIMIT to its solutions", async () => {
  for (const [modifier, expected] of [
    ["LIMIT 1", true],
    ["LIMIT 0", false],
    ["OFFSET 1", false],
  ] as const) {
    const result = await run(`ASK { ?s ?p ?o } ${modifier}`);
    assert.ok(result.kind === "ask");
    assert.strictEqual(result.data.boolean, expected, modifier);
  }
});

test("CONSTRUCT leaves out triples with a term in an invalid position", async () => {
  const result = await run(
    "CONSTRUCT { ?s <urn:has> ?name . ?name <urn:of> ?s . " +
      "?s ?name <urn:x> . <<( ?name <urn:p> ?s )>> <urn:q> ?s . " +
      "?s <urn:t> <<( ?name <urn:p> ?s )>> } WHERE { ?s <urn:name> ?name }",
  );
  assert.ok(result.kind === "construct");
  assert.deepStrictEqual(
    result.data.quads.map((item) => item.predicate.value),
    ["urn:has"],
  );
});

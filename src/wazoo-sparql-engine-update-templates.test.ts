import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "@/store/memory-store.ts";
import { DataFactory } from "@/term/public.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { literal, namedNode, quad } = DataFactory;

/** updated applies an update to two named graphs and lists the new triples. */
async function updated(update: string): Promise<string[]> {
  const store = new MemoryStore();
  for (const graph of ["g1", "g2"]) {
    store.addQuad(
      quad(
        namedNode(`urn:${graph}-subject`),
        namedNode("urn:name"),
        literal(graph),
        namedNode(`urn:${graph}`),
      ),
    );
  }
  await new WazooSparqlEngine({ store }).execute({ query: update });
  return store
    .getQuads(null, null, null, null)
    .filter((item) => item.predicate.value !== "urn:name")
    .map((item) =>
      [item.subject, item.predicate, item.object, item.graph]
        .map((term) => term.value)
        .join(" "),
    )
    .sort();
}

test("an INSERT template takes its graph name from each solution", async () => {
  assert.deepStrictEqual(
    await updated(
      "INSERT { GRAPH ?g { ?g <urn:holds> ?s } } " +
        "WHERE { GRAPH ?g { ?s <urn:name> ?n } }",
    ),
    [
      "urn:g1 urn:holds urn:g1-subject urn:g1",
      "urn:g2 urn:holds urn:g2-subject urn:g2",
    ],
  );
});

test("an unbound or literal graph name leaves its triples out", async () => {
  for (const name of ["?missing", "?n"]) {
    assert.deepStrictEqual(
      await updated(
        `INSERT { GRAPH ${name} { ?s <urn:p> ?s } . ?s <urn:kept> ?s } ` +
          "WHERE { GRAPH <urn:g1> { ?s <urn:name> ?n } }",
      ),
      ["urn:g1-subject urn:kept urn:g1-subject "],
    );
  }
});

test("an INSERT template skips triples with a term in an invalid position", async () => {
  assert.deepStrictEqual(
    await updated(
      "INSERT { ?n <urn:of> ?s . ?s ?n <urn:x> . " +
        "?s <urn:quoted> <<( ?n <urn:p> ?s )>> . ?s <urn:has> ?n } " +
        "WHERE { GRAPH <urn:g1> { ?s <urn:name> ?n } }",
    ),
    ["urn:g1-subject urn:has g1 "],
  );
});

import { DataFactory } from "@/term/mod.ts";
import {
  exampleA,
  exampleP,
  exampleQ,
  exampleV,
  RecordingTransaction,
} from "@/evaluator/update-evaluator-test-helpers.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { rejected } from "../../test/thrown.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

test("UpdateEvaluator - INSERT DATA buffers through the transaction and commits", async () => {
  const store = new Store();
  let transactionsCreated = 0;
  const transaction = new RecordingTransaction(store);
  const engine = new WazooSparqlEngine({
    store,
    createTransaction: () => {
      transactionsCreated++;
      return transaction;
    },
  });

  const result = await engine.execute({
    query: 'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
  });

  assert.deepStrictEqual(result.kind, "void");
  assert.deepStrictEqual(transactionsCreated, 1);
  assert.deepStrictEqual(transaction.added.length, 1);
  assert.deepStrictEqual(transaction.deleted.length, 0);
  assert.deepStrictEqual(transaction.committed, true);
  assert.deepStrictEqual(transaction.rolledBack, false);
  // The quad reached the store only via the transaction's commit.
  assert.deepStrictEqual(store.countQuads(exampleA, exampleP, null, null), 1);
});

test("UpdateEvaluator - nothing touches the store until commit", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store, false);
  const engine = new WazooSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  await engine.execute({
    query: 'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
  });

  assert.deepStrictEqual(transaction.added.length, 1);
  assert.deepStrictEqual(transaction.committed, true);
  // The engine never wrote to the store directly; the buffered quad was
  // discarded because the fake does not apply on commit.
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 0);
});

test("UpdateEvaluator - rollback discards buffered changes when an operation fails", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store);
  const evaluator = new (await import("./update-evaluator.ts")).UpdateEvaluator(
    {
      store,
      createTransaction: () => transaction,
    },
  );

  await rejected(
    () =>
      evaluator.executeUpdate({
        type: "update",
        prefixes: {},
        updates: [
          {
            updateType: "insert",
            insert: [
              {
                type: "bgp",
                triples: [
                  {
                    subject: namedNode("http://example.org/a"),
                    predicate: namedNode("http://example.org/p"),
                    object: literal("v"),
                  },
                ],
              },
            ],
          },
          {
            type: "unsupported_op",
          } as unknown as import("@/parser/sparql-parser.ts").UpdateOperation,
        ],
      }),
    Error,
    "Unsupported SPARQL update operation: unsupported_op",
  );

  assert.deepStrictEqual(transaction.added.length, 1);
  assert.deepStrictEqual(transaction.committed, false);
  assert.deepStrictEqual(transaction.rolledBack, true);
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 0);
});

test("UpdateEvaluator - rollback when commit fails", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store);
  transaction.failCommit = true;
  const engine = new WazooSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  await rejected(
    () =>
      engine.execute({
        query:
          'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
      }),
    Error,
    "commit failed",
  );

  assert.deepStrictEqual(transaction.committed, false);
  assert.deepStrictEqual(transaction.rolledBack, true);
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 0);
});

test("UpdateEvaluator - DELETE/INSERT through the transaction buffers deletes and inserts", async () => {
  const store = new Store();
  store.addQuad(quad(exampleA, exampleP, exampleV));
  const transaction = new RecordingTransaction(store);
  const engine = new WazooSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  const result = await engine.execute({
    query:
      "DELETE { ?s <http://example.org/p> ?o } " +
      "INSERT { ?s <http://example.org/q> ?o } " +
      "WHERE { ?s <http://example.org/p> ?o }",
  });

  assert.deepStrictEqual(result.kind, "void");
  assert.deepStrictEqual(transaction.deleted.length, 1);
  assert.deepStrictEqual(transaction.added.length, 1);
  assert.deepStrictEqual(transaction.committed, true);
  assert.deepStrictEqual(transaction.rolledBack, false);
  // The move was applied atomically at commit time.
  assert.deepStrictEqual(store.countQuads(null, exampleP, null, null), 0);
  assert.deepStrictEqual(store.countQuads(null, exampleQ, null, null), 1);
});

test("UpdateEvaluator - CLEAR, DROP, CREATE operations work", async () => {
  const store = new Store();
  store.addQuad(quad(exampleA, exampleP, exampleV));
  store.addQuad(
    quad(exampleA, exampleP, exampleV, namedNode("http://example.org/g1")),
  );

  const engine = new WazooSparqlEngine({ store });

  await engine.execute({
    query: "CREATE SILENT GRAPH <http://example.org/g2>",
  });

  await engine.execute({ query: "CLEAR GRAPH <http://example.org/g1>" });
  assert.deepStrictEqual(
    store.countQuads(null, null, null, namedNode("http://example.org/g1")),
    0,
  );
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 1);

  await engine.execute({ query: "DROP ALL" });
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 0);
});

test("UpdateEvaluator - LOAD merges the document dataset, preserving named graphs", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const file = `${dir}/data.trig`;
  await writeFile(
    file,
    `
    @prefix : <http://example.org/> .
    :s :p :o .
    :g { :a :b :c . }
  `,
  );

  await engine.execute({ query: `LOAD <file://${file.replace(/\\/g, "/")}>` });

  // default graph triples and the TriG named graph are both merged in.
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 2);
  assert.deepStrictEqual(store.countQuads(null, null, null, defaultGraph()), 1);
  assert.deepStrictEqual(
    store.countQuads(null, null, null, namedNode("http://example.org/g")),
    1,
  );
});

test("UpdateEvaluator - LOAD INTO GRAPH maps the default graph into the destination", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const file = `${dir}/data.ttl`;
  await writeFile(
    file,
    "<http://example.org/s> <http://example.org/p> <http://example.org/o> .",
  );

  await engine.execute({
    query: `LOAD <file://${file.replace(
      /\\/g,
      "/",
    )}> INTO GRAPH <http://example.org/dest>`,
  });

  assert.deepStrictEqual(
    store.countQuads(null, null, null, namedNode("http://example.org/dest")),
    1,
  );
});

test("UpdateEvaluator - LOAD INTO GRAPH rejects documents that contain named graphs", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const file = `${dir}/data.trig`;
  await writeFile(
    file,
    "<http://example.org/g> { <http://example.org/s> <http://example.org/p> <http://example.org/o> . }",
  );

  await rejected(
    () =>
      engine.execute({
        query: `LOAD <file://${file.replace(
          /\\/g,
          "/",
        )}> INTO GRAPH <http://example.org/dest>`,
      }),
    Error,
  );
});

test("UpdateEvaluator - LOAD operation with SILENT error handling", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  // Non-existent file with SILENT does not throw
  await engine.execute({ query: "LOAD SILENT <file:///nonexistent-file.ttl>" });
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 0);
});

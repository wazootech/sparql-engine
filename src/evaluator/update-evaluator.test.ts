import { assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { NativeSparqlEngine } from "@/native-sparql-engine.ts";
import type { NativeSparqlTransaction } from "@/native-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

const exampleP = namedNode("http://example.org/p");
const exampleQ = namedNode("http://example.org/q");
const exampleV = namedNode("http://example.org/v");
const exampleA = namedNode("http://example.org/a");

/**
 * RecordingTransaction is a fake NativeSparqlTransaction that records every
 * buffered add/delete and, when applyOnCommit is set, applies them to the
 * backing store at commit time. It can be told to fail on commit to exercise
 * the rollback path.
 */
class RecordingTransaction implements NativeSparqlTransaction {
  public readonly added: rdfjs.Quad[] = [];
  public readonly deleted: rdfjs.Quad[] = [];
  public committed = false;
  public rolledBack = false;
  public failCommit = false;

  public constructor(
    private readonly store: Store,
    private readonly applyOnCommit = true,
  ) {}

  public add(item: rdfjs.Quad): void {
    this.added.push(item);
  }

  public delete(item: rdfjs.Quad): void {
    this.deleted.push(item);
  }

  public commit(): Promise<void> {
    if (this.failCommit) {
      return Promise.reject(new Error("commit failed"));
    }
    if (this.applyOnCommit) {
      for (const item of this.added) {
        this.store.addQuad(item);
      }
      for (const item of this.deleted) {
        this.store.removeQuad(item);
      }
    }
    this.committed = true;
    return Promise.resolve();
  }

  public rollback(): void {
    this.rolledBack = true;
  }
}

Deno.test("UpdateEvaluator - INSERT DATA buffers through the transaction and commits", async () => {
  const store = new Store();
  let transactionsCreated = 0;
  const transaction = new RecordingTransaction(store);
  const engine = new NativeSparqlEngine({
    store,
    createTransaction: () => {
      transactionsCreated++;
      return transaction;
    },
  });

  const result = await engine.execute({
    query: 'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
  });

  assertEquals(result.kind, "void");
  assertEquals(transactionsCreated, 1);
  assertEquals(transaction.added.length, 1);
  assertEquals(transaction.deleted.length, 0);
  assertEquals(transaction.committed, true);
  assertEquals(transaction.rolledBack, false);
  // The quad reached the store only via the transaction's commit.
  assertEquals(store.countQuads(exampleA, exampleP, null, null), 1);
});

Deno.test("UpdateEvaluator - nothing touches the store until commit", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store, false);
  const engine = new NativeSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  await engine.execute({
    query: 'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
  });

  assertEquals(transaction.added.length, 1);
  assertEquals(transaction.committed, true);
  // The engine never wrote to the store directly; the buffered quad was
  // discarded because the fake does not apply on commit.
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("UpdateEvaluator - rollback discards buffered changes when an operation fails", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store);
  const evaluator = new (await import("./update-evaluator.ts")).UpdateEvaluator(
    {
      store,
      createTransaction: () => transaction,
    },
  );

  await assertRejects(
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
          } as unknown as import("sparqljs").UpdateOperation,
        ],
      }),
    Error,
    "Unsupported SPARQL update operation: unsupported_op",
  );

  assertEquals(transaction.added.length, 1);
  assertEquals(transaction.committed, false);
  assertEquals(transaction.rolledBack, true);
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("UpdateEvaluator - rollback when commit fails", async () => {
  const store = new Store();
  const transaction = new RecordingTransaction(store);
  transaction.failCommit = true;
  const engine = new NativeSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  await assertRejects(
    () =>
      engine.execute({
        query:
          'INSERT DATA { <http://example.org/a> <http://example.org/p> "v" }',
      }),
    Error,
    "commit failed",
  );

  assertEquals(transaction.committed, false);
  assertEquals(transaction.rolledBack, true);
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("UpdateEvaluator - DELETE/INSERT through the transaction buffers deletes and inserts", async () => {
  const store = new Store();
  store.addQuad(quad(exampleA, exampleP, exampleV));
  const transaction = new RecordingTransaction(store);
  const engine = new NativeSparqlEngine({
    store,
    createTransaction: () => transaction,
  });

  const result = await engine.execute({
    query: "DELETE { ?s <http://example.org/p> ?o } " +
      "INSERT { ?s <http://example.org/q> ?o } " +
      "WHERE { ?s <http://example.org/p> ?o }",
  });

  assertEquals(result.kind, "void");
  assertEquals(transaction.deleted.length, 1);
  assertEquals(transaction.added.length, 1);
  assertEquals(transaction.committed, true);
  assertEquals(transaction.rolledBack, false);
  // The move was applied atomically at commit time.
  assertEquals(store.countQuads(null, exampleP, null, null), 0);
  assertEquals(store.countQuads(null, exampleQ, null, null), 1);
});

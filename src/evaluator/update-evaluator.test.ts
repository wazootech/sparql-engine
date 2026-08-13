import { assertEquals, assertRejects } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { WazooSparqlTransaction } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

const exampleP = namedNode("http://example.org/p");
const exampleQ = namedNode("http://example.org/q");
const exampleV = namedNode("http://example.org/v");
const exampleA = namedNode("http://example.org/a");

/**
 * RecordingTransaction is a fake WazooSparqlTransaction that records every
 * buffered add/delete and, when applyOnCommit is set, applies them to the
 * backing store at commit time. It can be told to fail on commit to exercise
 * the rollback path.
 */
class RecordingTransaction implements WazooSparqlTransaction {
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
  const engine = new WazooSparqlEngine({
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
          } as unknown as import("@/parser/sparql-parser.ts").UpdateOperation,
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
  const engine = new WazooSparqlEngine({
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
  const engine = new WazooSparqlEngine({
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

Deno.test("UpdateEvaluator - CLEAR, DROP, CREATE operations work", async () => {
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
  assertEquals(
    store.countQuads(null, null, null, namedNode("http://example.org/g1")),
    0,
  );
  assertEquals(store.countQuads(null, null, null, null), 1);

  await engine.execute({ query: "DROP ALL" });
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("UpdateEvaluator - LOAD merges the document dataset, preserving named graphs", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await Deno.makeTempDir();
  const file = `${dir}/data.trig`;
  await Deno.writeTextFile(
    file,
    `
    @prefix : <http://example.org/> .
    :s :p :o .
    :g { :a :b :c . }
  `,
  );

  await engine.execute({ query: `LOAD <file://${file.replace(/\\/g, "/")}>` });

  // default graph triples and the TriG named graph are both merged in.
  assertEquals(store.countQuads(null, null, null, null), 2);
  assertEquals(
    store.countQuads(null, null, null, defaultGraph()),
    1,
  );
  assertEquals(
    store.countQuads(null, null, null, namedNode("http://example.org/g")),
    1,
  );
});

Deno.test("UpdateEvaluator - LOAD INTO GRAPH maps the default graph into the destination", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await Deno.makeTempDir();
  const file = `${dir}/data.ttl`;
  await Deno.writeTextFile(
    file,
    "<http://example.org/s> <http://example.org/p> <http://example.org/o> .",
  );

  await engine.execute({
    query: `LOAD <file://${
      file.replace(/\\/g, "/")
    }> INTO GRAPH <http://example.org/dest>`,
  });

  assertEquals(
    store.countQuads(null, null, null, namedNode("http://example.org/dest")),
    1,
  );
});

Deno.test("UpdateEvaluator - LOAD INTO GRAPH rejects documents that contain named graphs", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await Deno.makeTempDir();
  const file = `${dir}/data.trig`;
  await Deno.writeTextFile(
    file,
    "<http://example.org/g> { <http://example.org/s> <http://example.org/p> <http://example.org/o> . }",
  );

  await assertRejects(
    () =>
      engine.execute({
        query: `LOAD <file://${
          file.replace(/\\/g, "/")
        }> INTO GRAPH <http://example.org/dest>`,
      }),
    Error,
  );
});

Deno.test("UpdateEvaluator - LOAD operation with SILENT error handling", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  // Non-existent file with SILENT does not throw
  await engine.execute({ query: "LOAD SILENT <file:///nonexistent-file.ttl>" });
  assertEquals(store.countQuads(null, null, null, null), 0);
});

Deno.test("UpdateEvaluator - LOAD then reified patterns match grammar reifier output", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await Deno.makeTempDir();
  const file = `${dir}/data.ttl`;
  await Deno.writeTextFile(
    file,
    `
    @prefix : <http://example.com/ns#> .
    :s :p :o ~ :iri {| :r :Z1 |} .
    :s :p :o2 ~ {| :r :Z2 |} .
    :r1 :reifies <<( :a :b <<( :d :e :f )>> )>> .
  `,
  );

  await engine.execute({ query: `LOAD <file://${file.replace(/\\/g, "/")}>` });

  // The jison grammar emits `reifier rdf:reifies <<( s p o )>>` for a reified
  // triple, and annotation blocks attach to the reifier; the evaluator's
  // reified.ts expansion must agree with that shape.
  let result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ :iri {| :r ?Z |} }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(
      result.data.results.bindings[0].o.value,
      "http://example.com/ns#o",
    );
    assertEquals(
      result.data.results.bindings[0].Z.value,
      "http://example.com/ns#Z1",
    );
  }

  // A variable reifier binds both the explicit IRI reifier and the fresh
  // blank-node reifier the grammar minted for the bare `~`.
  result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ ?r {| :r ?Z |} }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 2);
  }

  // A data triple term (including a nested one) in object position matches
  // the grammar's plain-Quad triple terms.
  result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT ?r WHERE { ?r :reifies <<( :a :b <<( :d :e :f )>> )>> }",
  });
  assertEquals(result.kind, "select");
  if (result.kind === "select") {
    assertEquals(result.data.results.bindings.length, 1);
    assertEquals(
      result.data.results.bindings[0].r.value,
      "http://example.com/ns#r1",
    );
  }
});

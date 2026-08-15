// SqliteStore vs MemoryStore benchmark (issue #56, workstream 2).
//
// Answers "when is the durable store worth the I/O" with measured numbers:
// bulk load (autocommit vs one transaction), pattern match (full scan /
// single-predicate / graph-scoped), countQuads, engine-level update
// throughput (INSERT DATA / DELETE WHERE through WazooSparqlTransaction),
// and the commit cost of synchronous=FULL vs NORMAL.
//
// Manual timing (not Deno.bench): each measured iteration runs on a freshly
// seeded store, and only the operation is timed — seeding stays outside the
// timer so the numbers are honest per-operation costs.
//
// Run: deno task bench:sqlite
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { SqliteStore } from "@/store/sqlite-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

const QUAD_COUNT = 10_000;
const ITERATIONS = 5;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const foafName = ex("name");
const graphA = ex("g/a");

/** buildQuads returns a people-shaped dataset of QUAD_COUNT quads. */
function buildQuads(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < QUAD_COUNT; index++) {
    const person = ex(`person${index}`);
    quads.push(quad(person, foafName, literal(`Name ${index}`)));
    quads.push(quad(person, ex("age"), literal(`${index}`)));
    if (index % 2 === 0) {
      quads.push(
        quad(person, ex("knows"), ex(`person${(index + 1) % QUAD_COUNT}`)),
      );
    }
    if (index % 10 === 0) {
      quads.push(quad(person, ex("graphProp"), ex("v"), graphA));
    }
  }
  return quads;
}

/** sqliteTempPath returns a fresh temp db path for one bench case. */
function sqliteTempPath(): string {
  const dir = Deno.makeTempDirSync();
  return `${dir}/bench.sqlite`;
}

/** seededMemory loads the dataset into a fresh MemoryStore. */
function seededMemory(): MemoryStore {
  const store = new MemoryStore();
  for (const item of buildQuads()) {
    store.addQuad(item);
  }
  return store;
}

/** seededSqlite loads the dataset into a fresh SqliteStore in one commit. */
function seededSqlite(): SqliteStore {
  const store = new SqliteStore({ path: sqliteTempPath() });
  const transaction = store.createTransaction();
  for (const item of buildQuads()) {
    transaction.add(item);
  }
  transaction.commit();
  return store;
}

/** sqliteEngine builds a WazooSparqlEngine over a seeded SqliteStore. */
function sqliteEngine(): {
  store: SqliteStore;
  engine: WazooSparqlEngine;
} {
  const store = seededSqlite();
  const engine = new WazooSparqlEngine({
    store,
    createTransaction: () => store.createTransaction(),
  });
  return { store, engine };
}

/**
 * measureOp times only `op` over `iterations` fresh runs: each run builds a
 * fresh target via `setup` (untimed), then times the operation. A warmup run
 * primes V8 and SQLite caches.
 */
async function measureOp<T>(
  setup: () => T,
  op: (target: T) => void | Promise<void>,
  iterations = ITERATIONS,
): Promise<number> {
  await op(setup()); // warmup
  let total = 0;
  for (let index = 0; index < iterations; index++) {
    const target = setup();
    const start = performance.now();
    await op(target);
    total += performance.now() - start;
  }
  return total / iterations;
}

/** row prints one comparison line. */
function row(name: string, memoryMs: number, sqliteMs: number): void {
  console.log(
    `| ${name.padEnd(34)} | ${memoryMs.toFixed(1).padStart(8)} | ` +
      `${sqliteMs.toFixed(1).padStart(9)} | ${
        (sqliteMs / memoryMs).toFixed(1).padStart(6)
      }x |`,
  );
}

async function main(): Promise<void> {
  console.log(
    "SqliteStore vs MemoryStore (avg ms over 5 fresh runs; sqlite/memory ratio):",
  );
  console.log(
    "| operation                              |   memory |    sqlite |  ratio |",
  );
  console.log(
    "| -------------------------------------- | -------- | --------- | ------ |",
  );

  // Bulk load — memory vs sqlite autocommit vs one-transaction.
  const memoryLoad = await measureOp(() => new MemoryStore(), (store) => {
    for (const item of buildQuads()) {
      store.addQuad(item);
    }
  });
  const sqliteAutocommit = await measureOp(
    () => new SqliteStore({ path: sqliteTempPath() }),
    (store) => {
      try {
        for (const item of buildQuads()) {
          store.addQuad(item);
        }
      } finally {
        store.close();
      }
    },
  );
  const sqliteTransactional = await measureOp(
    () => new SqliteStore({ path: sqliteTempPath() }),
    (store) => {
      try {
        const transaction = store.createTransaction();
        for (const item of buildQuads()) {
          transaction.add(item);
        }
        transaction.commit();
      } finally {
        store.close();
      }
    },
  );
  console.log(
    `| ${"bulk load 10k (addQuad)".padEnd(34)} | ${
      memoryLoad.toFixed(1).padStart(8)
    } | ` +
      `${sqliteAutocommit.toFixed(1).padStart(9)} | ${
        (sqliteAutocommit / memoryLoad).toFixed(1).padStart(6)
      }x |`,
  );
  console.log(
    `| ${"bulk load 10k (one transaction)".padEnd(34)} | ${
      memoryLoad.toFixed(1).padStart(8)
    } | ` +
      `${sqliteTransactional.toFixed(1).padStart(9)} | ${
        (sqliteTransactional / memoryLoad).toFixed(1).padStart(6)
      }x |`,
  );

  row(
    "match all 10k",
    await measureOp(seededMemory, (s) => {
      [...s.match()];
    }),
    await measureOp(seededSqlite, (s) => {
      try {
        [...s.match()];
      } finally {
        s.close();
      }
    }),
  );
  row(
    "match single-predicate 10k",
    await measureOp(seededMemory, (s) => {
      [...s.match(null, foafName)];
    }),
    await measureOp(seededSqlite, (s) => {
      try {
        [...s.match(null, foafName)];
      } finally {
        s.close();
      }
    }),
  );
  row(
    "match graph-scoped 10k",
    await measureOp(seededMemory, (s) => {
      [...s.match(null, null, null, graphA)];
    }),
    await measureOp(seededSqlite, (s) => {
      try {
        [...s.match(null, null, null, graphA)];
      } finally {
        s.close();
      }
    }),
  );
  row(
    "countQuads 10k",
    await measureOp(seededMemory, (s) => {
      s.countQuads();
    }),
    await measureOp(seededSqlite, (s) => {
      try {
        s.countQuads();
      } finally {
        s.close();
      }
    }),
  );

  // Engine-level update throughput: 200 single-request INSERT DATA / 100
  // DELETE WHERE, each request through one transaction on sqlite.
  row(
    "engine INSERT DATA x200",
    await measureOp(seededMemory, async (store) => {
      const engine = new WazooSparqlEngine({ store });
      for (let index = 0; index < 200; index++) {
        await engine.execute({
          query: `INSERT DATA { <http://example.org/u${index}> ` +
            `<http://example.org/p> "v${index}" }`,
        });
      }
    }),
    await measureOp(sqliteEngine, async ({ store, engine }) => {
      try {
        for (let index = 0; index < 200; index++) {
          await engine.execute({
            query: `INSERT DATA { <http://example.org/u${index}> ` +
              `<http://example.org/p> "v${index}" }`,
          });
        }
      } finally {
        store.close();
      }
    }),
  );
  row(
    "engine DELETE WHERE x100",
    await measureOp(seededMemory, async (store) => {
      const engine = new WazooSparqlEngine({ store });
      for (let index = 0; index < 100; index++) {
        await engine.execute({
          query: `DELETE WHERE { <http://example.org/person${index}> ?p ?o }`,
        });
      }
    }),
    await measureOp(sqliteEngine, async ({ store, engine }) => {
      try {
        for (let index = 0; index < 100; index++) {
          await engine.execute({
            query: `DELETE WHERE { <http://example.org/person${index}> ?p ?o }`,
          });
        }
      } finally {
        store.close();
      }
    }),
  );

  // Commit cost under synchronous=FULL (default) vs NORMAL.
  const commitMs = async (mode: "FULL" | "NORMAL"): Promise<number> =>
    await measureOp(
      () => new SqliteStore({ path: sqliteTempPath() }),
      (store) => {
        try {
          store.db.exec(`PRAGMA synchronous = ${mode}`);
          for (let round = 0; round < 10; round++) {
            const transaction = store.createTransaction();
            for (let index = 0; index < 100; index++) {
              transaction.add(
                quad(ex(`c${round}-${index}`), ex("p"), literal(`${index}`)),
              );
            }
            transaction.commit();
          }
        } finally {
          store.close();
        }
      },
    );
  const fullMs = await commitMs("FULL");
  const normalMs = await commitMs("NORMAL");
  console.log(
    `| ${"commit 1k quads (10 x 100) FULL".padEnd(34)} | ${"".padStart(8)} | ${
      fullMs.toFixed(1).padStart(9)
    } | ${"".padStart(6)} |`,
  );
  console.log(
    `| ${"commit 1k quads (10 x 100) NORMAL".padEnd(34)} | ${
      "".padStart(8)
    } | ${normalMs.toFixed(1).padStart(9)} | ${
      (fullMs / normalMs).toFixed(1).padStart(6)
    }x |`,
  );

  console.log(
    "Read amplification note: sqlite match decodes a lossless JSON payload per " +
      "row, so pattern scans are the durable store's dominant cost.",
  );
}

if (import.meta.main) {
  main();
}

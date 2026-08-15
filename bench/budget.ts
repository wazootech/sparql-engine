import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { SqliteStore } from "@/store/sqlite-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

interface BudgetTest {
  name: string;
  query: string;
  /**
   * Per-test ceiling in ms/iter, calibrated to ~2.5x the baseline measured on the
   * GitHub Actions runner (the environment bench:check actually gates in), so a
   * ~3x regression on any row trips the gate while run-to-run CI noise passes.
   *
   * CI-runner baselines (ms/iter, 50-iteration loop after 5-iteration warmup):
   *   BGP 2-pattern join: 1.30 -> budget 3.5 (~2.7x)
   *   Reorder chain join: 0.82 -> budget 2.0 (~2.4x)
   *   EXISTS filter:      1.16 -> budget 3.0 (~2.6x)
   *   Nested EXISTS:      1.61 -> budget 4.0 (~2.5x)
   *
   * Note: GitHub runners are ~3x slower than a quiet dev machine (this machine
   * measures the same rows at 0.3-0.5 ms), so budgets must not be calibrated
   * locally. A regression of ~2.5-3x trips the gate; catastrophic algorithmic
   * regressions (e.g. EXISTS per-probe re-indexing was ~480x at its worst) trip
   * instantly.
   */
  budgetMs: number;
}

const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 50;

const tests: BudgetTest[] = [
  {
    name: "BGP 2-pattern join",
    query:
      "SELECT ?s ?name WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name . ?s <http://example.org/p> ?o }",
    budgetMs: 3.5,
  },
  {
    name: "Reorder chain join",
    query:
      "SELECT ?s WHERE { ?s <http://example.org/p1> ?o1 . ?o1 <http://example.org/p2> ?o2 }",
    budgetMs: 2.0,
  },
  {
    name: "EXISTS filter",
    query: "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
      "FILTER EXISTS { ?s <http://example.org/p> ?o } }",
    budgetMs: 3.0,
  },
  {
    name: "Nested EXISTS filter",
    query: "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
      "FILTER EXISTS { ?s <http://example.org/p1> ?o . " +
      "FILTER EXISTS { ?o <http://example.org/p2> ?x } } }",
    budgetMs: 4.0,
  },
];

/**
 * sqliteTempPath returns a fresh temp db path for one store budget run.
 */
function sqliteTempPath(): string {
  const dir = Deno.makeTempDirSync();
  return `${dir}/budget.sqlite`;
}

/**
 * SqliteStore sanity budgets (issue #56): the durable store's transactional
 * load and full-scan match must stay within generous ceilings. Local
 * dev-machine baselines are ~190 ms for a 5k-quad single-transaction load
 * and ~18 ms for a 5k match; GitHub runners are ~3x slower, so the budgets
 * carry ~4x headroom — this gate catches catastrophic regressions (per-row
 * fsync, per-probe index rebuild, payload decode blowups), not noise.
 */
const storeTests: { name: string; budgetMs: number; run: () => void }[] = [
  {
    name: "SqliteStore bulk load 5k (one transaction)",
    budgetMs: 2500,
    run: () => {
      const store = new SqliteStore({ path: sqliteTempPath() });
      const transaction = store.createTransaction();
      for (let index = 0; index < 5000; index++) {
        transaction.add(
          quad(
            namedNode(`http://example.org/s${index}`),
            namedNode("http://example.org/p"),
            literal(`v${index}`),
          ),
        );
      }
      transaction.commit();
      store.close();
    },
  },
  {
    name: "SqliteStore full match over 5k",
    budgetMs: 2500,
    run: () => {
      const store = new SqliteStore({ path: sqliteTempPath() });
      const transaction = store.createTransaction();
      for (let index = 0; index < 5000; index++) {
        transaction.add(
          quad(
            namedNode(`http://example.org/s${index}`),
            namedNode("http://example.org/p"),
            literal(`v${index}`),
          ),
        );
      }
      transaction.commit();
      [...store.match()];
      store.close();
    },
  },
];

async function main() {
  const store = new Store();
  for (let i = 0; i < 100; i++) {
    const s = namedNode(`http://example.org/s${i}`);
    store.addQuad(
      quad(
        s,
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal(`Name ${i}`),
      ),
    );
    store.addQuad(
      quad(s, namedNode("http://example.org/p"), literal(`Val ${i}`)),
    );
    store.addQuad(
      quad(
        s,
        namedNode("http://example.org/p1"),
        namedNode(`http://example.org/o${i}`),
      ),
    );
    store.addQuad(
      quad(
        namedNode(`http://example.org/o${i}`),
        namedNode("http://example.org/p2"),
        literal(`${i}`),
      ),
    );
  }

  const engine = new WazooSparqlEngine({ store });
  let failed = false;

  console.log("Running performance regression budget checks...");
  for (const test of storeTests) {
    // Warm up once (pays the table/index setup), then time one run.
    test.run();
    const start = performance.now();
    test.run();
    const elapsed = performance.now() - start;
    console.log(
      `- ${test.name}: ${
        elapsed.toFixed(0)
      } ms (budget: <= ${test.budgetMs} ms)`,
    );
    if (elapsed > test.budgetMs) {
      console.error(
        `  FAIL: ${test.name} exceeded performance budget (${
          elapsed.toFixed(0)
        } ms > ${test.budgetMs} ms)`,
      );
      failed = true;
    }
  }

  for (const test of tests) {
    // Warm up first: lets V8 optimize the hot path and pays the one-time
    // EXISTS snapshot drain before the timed loop, so measurements are stable.
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await engine.execute({ query: test.query });
    }

    const start = performance.now();
    for (let i = 0; i < MEASURED_ITERATIONS; i++) {
      await engine.execute({ query: test.query });
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / MEASURED_ITERATIONS;
    console.log(
      `- ${test.name}: ${
        avgMs.toFixed(3)
      } ms/iter (budget: <= ${test.budgetMs} ms/iter)`,
    );

    if (avgMs > test.budgetMs) {
      console.error(
        `  FAIL: ${test.name} exceeded performance budget (${
          avgMs.toFixed(3)
        } ms > ${test.budgetMs} ms)`,
      );
      failed = true;
    }
  }

  if (failed) {
    console.error("Performance regression budget checks failed.");
    Deno.exit(1);
  } else {
    console.log("All performance budget checks passed.");
  }
}

if (import.meta.main) {
  await main();
}

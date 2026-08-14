import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

interface BudgetTest {
  name: string;
  query: string;
  /**
   * Per-test ceiling in ms/iter. Calibrated to ~3x the steady-state baseline on a
   * quiet machine, so a ~3x regression on any row trips the gate while shared-CI
   * noise (typically 2-3x slower runners) still passes.
   *
   * Baselines (ms/iter, 50-iteration loop after 5-iteration warmup, quiet machine):
   *   BGP 2-pattern join: 0.34-0.44 (noisiest row) -> budget 2.0 (~4.5x)
   *   Reorder chain join: 0.29-0.39               -> budget 1.0 (~2.6-3.4x)
   *   EXISTS filter:      0.33-0.39               -> budget 1.0 (~2.6-3.0x)
   *   Nested EXISTS:      0.46-0.52               -> budget 1.6 (~3.1-3.5x)
   *
   * A regression of ~3x trips the chain/exists/nested rows; the join row needs
   * ~4.5x (it shows the most run-to-run variance, so it gets extra headroom).
   * Note: at this sub-ms scale, per-iteration cost is partly fixed parse/setup
   * overhead, so a small multiplicative filter regression lands under 3x and
   * correctly stays under budget - the gate catches the algorithmic regressions
   * that matter (e.g. EXISTS per-probe re-indexing was 480x at its worst).
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
    budgetMs: 2.0,
  },
  {
    name: "Reorder chain join",
    query:
      "SELECT ?s WHERE { ?s <http://example.org/p1> ?o1 . ?o1 <http://example.org/p2> ?o2 }",
    budgetMs: 1.0,
  },
  {
    name: "EXISTS filter",
    query: "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
      "FILTER EXISTS { ?s <http://example.org/p> ?o } }",
    budgetMs: 1.0,
  },
  {
    name: "Nested EXISTS filter",
    query: "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
      "FILTER EXISTS { ?s <http://example.org/p1> ?o . " +
      "FILTER EXISTS { ?o <http://example.org/p2> ?x } } }",
    budgetMs: 1.6,
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

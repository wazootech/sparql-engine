import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

interface BudgetTest {
  name: string;
  query: string;
  /**
   * Per-test ceiling in ms/iter, calibrated to ~2.5-3x the median measured
   * on the GitHub Actions runner (the environment bench:check actually gates
   * in), so a ~3x regression on any row trips the gate while run-to-run CI
   * noise passes.
   *
   * Calibration must come from the MEDIAN of recent main-branch CI runs, not
   * a single run: runner hardware varies widely (issue #203 investigation).
   * Main-branch CI history (14 runs, Aug 2026, ms/iter, median -> observed max):
   *   BGP 2-pattern join: 1.25 -> 2.79, budget 3.5 (~2.8x median, 1.3x max)
   *   Reorder chain join: 1.02 -> 1.98, budget 2.5 (~2.5x median, 1.3x max)
   *   EXISTS filter:      0.94 -> 1.59, budget 3.0 (~3.2x median, 1.9x max)
   *   Nested EXISTS:      1.44 -> 2.58, budget 4.0 (~2.8x median, 1.6x max)
   *
   * The chain row's original 2.0 ceiling was calibrated from one lucky-fast
   * run (0.82); main itself later measured 1.98 — within 1.2% of tripping —
   * and a noise-slowed CI runner (all four rows inflated together, code A/B
   * -verified at parity) pushed it to 2.62 and red-gated PR #203. Budgets
   * must clear the slowest observed main run, not the median, or noise beats
   * the gate before any regression does.
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
    budgetMs: 2.5,
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

import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

interface BudgetTest {
  name: string;
  query: string;
  /**
   * Per-test ceiling in ms/iter on the GitHub Actions runner — the
   * environment this gate actually runs in. Calibrate only from the MEDIAN
   * of recent main-branch CI runs, at ~2.5-3x the median with headroom over
   * the slowest observed run: the original chain ceiling came from one
   * lucky-fast run, and a noise-slowed runner later red-gated at-parity
   * code with it (PR #203 — the median gate below is the other half of the
   * fix). Never calibrate locally; dev machines run ~3x faster than CI.
   * A genuine ~3x regression still trips every row, and catastrophic ones
   * (EXISTS per-probe re-indexing once hit ~480x) at any budget. Current
   * ceilings derive from 14 Aug-2026 main runs (row medians 0.9-1.4 ms,
   * observed maxima up to 2.8); fresher distributions accumulate in the
   * job-summary JSON blocks this script appends on CI (see
   * writeStepSummary below).
   */
  budgetMs: number;
}

const WARMUP_ITERATIONS = 5;

/**
 * Measurement protocol: every test is measured as ROUNDS round averages of
 * MEASURED_ITERATIONS_PER_ROUND iterations each, with the tests interleaved
 * round by round, and the gate compares each row's MEDIAN round average
 * against its budget. A transient runner spike lands in one round — spread
 * across whichever tests it overlaps — and the median discards it, instead
 * of poisoning a single test's whole contiguous measurement window (the
 * failure mode behind the PR #203 red gate; see the BudgetTest note).
 * Budgets keep the same ms/iter scale either way: a quiet average and a
 * median of round averages estimate the same per-iteration cost.
 */
const ROUNDS = 5;
const MEASURED_ITERATIONS_PER_ROUND = 30;

/**
 * median returns the middle value of a sorted sample (averaging the two
 * middle values for even lengths). The gate uses it to discard transient
 * runner spikes: see the measurement protocol constants above.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface BudgetRow {
  name: string;
  budgetMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  exceeded: boolean;
}

/**
 * writeStepSummary records each measured row — median/min/max round averages
 * against its budget — into `$GITHUB_STEP_SUMMARY` when running on GitHub
 * Actions, as a human-readable markdown table plus a raw JSON block. The
 * JSON is the durable artifact: CI runs accumulate one table per run, and a
 * future budget recalibration can aggregate those blocks into a real
 * main-branch distribution instead of hand-scraping run logs (how the
 * numbers in the BudgetTest doc comment above were recovered). Outside CI
 * the function is a silent no-op.
 */
function writeStepSummary(rows: BudgetRow[]): void {
  const summaryPath = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summaryPath === undefined || summaryPath === "") return;

  const header =
    `### bench:check — perf budget rows\n\n| Test | Median | Min | Max | Budget | Result |\n| --- | --- | --- | --- | --- | --- |\n`;
  const table = rows.map((row) =>
    `| ${row.name} | ${row.medianMs.toFixed(3)} | ${row.minMs.toFixed(3)} | ${
      row.maxMs.toFixed(3)
    } | ${row.budgetMs.toFixed(1)} | ${row.exceeded ? "❌ FAIL" : "✅ pass"} |`
  ).join("\n");
  const payload = JSON.stringify(
    rows.map(({ name, medianMs, minMs, maxMs, budgetMs, exceeded }) => ({
      name,
      medianMs: Number(medianMs.toFixed(6)),
      minMs: Number(minMs.toFixed(6)),
      maxMs: Number(maxMs.toFixed(6)),
      budgetMs,
      exceeded,
    })),
  );
  // Append, never truncate: $GITHUB_STEP_SUMMARY is shared per job across
  // steps, and the GitHub docs require appending to preserve what other
  // steps in the job wrote.
  Deno.writeTextFileSync(
    summaryPath,
    `${header}${table}\n\n\`\`\`json\n${payload}\n\`\`\`\n`,
    { append: true },
  );
}

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

  // Warm up every query before any timed round: lets V8 optimize the hot
  // path and pays the one-time EXISTS snapshot drain up front, so the timed
  // rounds are stable.
  console.log("Running performance regression budget checks...");
  for (const test of tests) {
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await engine.execute({ query: test.query });
    }
  }

  // Interleave the tests round by round so no single test owns a contiguous
  // slice of machine time, then gate on the per-test median round average.
  const roundAverages: number[][] = tests.map(() => []);
  for (let round = 0; round < ROUNDS; round++) {
    for (const [testIndex, test] of tests.entries()) {
      const start = performance.now();
      for (let i = 0; i < MEASURED_ITERATIONS_PER_ROUND; i++) {
        await engine.execute({ query: test.query });
      }
      const averageMs = (performance.now() - start) /
        MEASURED_ITERATIONS_PER_ROUND;
      roundAverages[testIndex].push(averageMs);
    }
  }

  let failed = false;
  const rows = tests.map((test, testIndex) => {
    const averages = roundAverages[testIndex];
    const medianMs = median(averages);
    const minMs = Math.min(...averages);
    const maxMs = Math.max(...averages);
    console.log(
      `- ${test.name}: median ${
        medianMs.toFixed(3)
      } ms/iter over ${ROUNDS} rounds of ${MEASURED_ITERATIONS_PER_ROUND} iters (min ${
        minMs.toFixed(3)
      }, max ${maxMs.toFixed(3)}; budget: <= ${test.budgetMs} ms/iter)`,
    );

    const exceeded = medianMs > test.budgetMs;
    if (exceeded) {
      console.error(
        `  FAIL: ${test.name} exceeded performance budget (median ${
          medianMs.toFixed(3)
        } ms > ${test.budgetMs} ms)`,
      );
      failed = true;
    }
    return { ...test, medianMs, minMs, maxMs, exceeded };
  });

  writeStepSummary(rows);

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

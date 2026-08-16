import { assertEquals } from "@std/assert";
import { DataFactory } from "@/term/mod.ts";
import type { ScanEntry } from "@/evaluator/join.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  boundVariables,
  DP_MAX_PATTERNS,
  estimatedJoinCost,
  searchBestJoinOrder,
} from "@/planner/join-order-search.ts";
import type { EstimatedJoinState } from "@/planner/join-order-search.ts";
import type { PatternStats } from "@/planner/pattern-statistics.ts";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";

const { namedNode, literal, quad, variable } = DataFactory;

const knows = namedNode("http://example.org/knows");
const name = namedNode("http://example.org/name");
const spouse = namedNode("http://example.org/spouse");

/** entry builds a ScanEntry for the given pattern positions (no candidates). */
function entry(
  subject: SparqlTerm,
  predicate: SparqlTerm,
  object: SparqlTerm,
): ScanEntry {
  return { subject, predicate, object, candidates: [] };
}

const s = variable("s");
const o = variable("o");
const n = variable("n");
const z = variable("z");
const w = variable("w");

/** dense stats: every pattern variable distinct, buckets of ~1. */
function dense(candidates: number, ...vars: string[]): PatternStats {
  const distinctByVar: Partial<Record<string, number>> = {};
  for (const v of vars) {
    distinctByVar[v] = candidates;
  }
  return { candidates, distinctByVar };
}

const EMPTY: EstimatedJoinState = { card: 1, bound: new Set() };

/** planCost computes the estimated total work of an order under the model. */
function planCost(
  entries: ScanEntry[],
  stats: PatternStats[],
  order: number[],
  initial: EstimatedJoinState = EMPTY,
): number {
  let card = initial.card;
  const bound = new Set(initial.bound);
  let total = 0;
  for (const index of order) {
    const cost = estimatedJoinCost(entries[index], stats[index], {
      card,
      bound,
    });
    total += cost;
    card = cost;
    for (
      const term of [
        entries[index].subject,
        entries[index].predicate,
        entries[index].object,
      ]
    ) {
      if (term.termType === "Variable") {
        bound.add(term.value);
      }
    }
  }
  return total;
}

Deno.test(
  "searchBestJoinOrder - DP beats greedy on the two-shared-variable shape",
  () => {
    // ?s knows ?o and ?s name ?o share both variables; ?z spouse ?w shares
    // none and is smaller. Greedy (cheapest-first) joins spouse first, then
    // pays the full cross product twice; the DP joins the shared pair first
    // and pays the cross product once.
    const entries = [
      entry(s, knows, o),
      entry(s, name, n),
      entry(z, spouse, w),
    ];
    const stats = [
      dense(10_000, "s", "o"),
      dense(10_000, "s", "n"),
      dense(5_000, "z", "w"),
    ];
    const order = searchBestJoinOrder(entries, stats, EMPTY)!;
    assertEquals(order, [0, 1, 2]);
    // Greedy picks the cheapest first: spouse (5k) before either 10k
    // pattern, yielding the [2, 0, 1] order and double the work.
    const greedyOrder = [2, 0, 1];
    assertEquals(
      planCost(entries, stats, order),
      10_000 + 10_000 + 10_000 * 5_000,
    );
    assertEquals(
      planCost(entries, stats, greedyOrder),
      5_000 + 5_000 * 10_000 + 50_000_000,
    );
    assertEquals(
      planCost(entries, stats, order) < planCost(entries, stats, greedyOrder),
      true,
    );
  },
);

Deno.test("searchBestJoinOrder - returns null above the DP threshold", () => {
  const entries: ScanEntry[] = [];
  const stats: PatternStats[] = [];
  for (let index = 0; index < DP_MAX_PATTERNS + 1; index++) {
    entries.push(entry(s, name, o));
    stats.push(dense(10, "s", "o"));
  }
  assertEquals(searchBestJoinOrder(entries, stats, EMPTY), null);
});

Deno.test("searchBestJoinOrder - empty BGP yields an empty order", () => {
  assertEquals(searchBestJoinOrder([], [], EMPTY), []);
});

Deno.test(
  "searchBestJoinOrder - a pre-bound variable steers the plan to its pattern",
  () => {
    // ?s is already bound (card 1): joining the knows pattern probes its
    // index (cost 1) instead of scanning all 10,000 candidates, so the
    // bound pattern goes first even though the other pattern is smaller.
    const entries = [entry(s, knows, o), entry(z, spouse, w)];
    const stats = [dense(10_000, "s", "o"), dense(5_000, "z", "w")];
    const bound = new Set(["s"]);
    const order = searchBestJoinOrder(entries, stats, { card: 1, bound })!;
    assertEquals(order, [0, 1]);
    assertEquals(
      planCost(entries, stats, order, { card: 1, bound }),
      1 + 5_000,
    );
  },
);

Deno.test("estimatedJoinCost - unbound pattern variable scans all candidates", () => {
  assertEquals(
    estimatedJoinCost(entry(s, knows, o), dense(100, "s", "o"), {
      card: 7,
      bound: new Set(["z"]),
    }),
    700,
  );
});

Deno.test("estimatedJoinCost - bound variable costs card times the bucket", () => {
  assertEquals(
    estimatedJoinCost(entry(s, knows, o), dense(100, "s", "o"), {
      card: 7,
      bound: new Set(["s"]),
    }),
    7,
  );
});

Deno.test("estimatedJoinCost - a variable without stats is never assumed", () => {
  // The stats carry no distinct count for ?s: the variable contributes
  // nothing, so the join falls back to scanning all candidates.
  const stats: PatternStats = { candidates: 100, distinctByVar: { o: 100 } };
  assertEquals(
    estimatedJoinCost(entry(s, knows, o), stats, {
      card: 7,
      bound: new Set(["s"]),
    }),
    700,
  );
});

Deno.test("estimatedJoinCost - zero-cardinality state costs zero", () => {
  assertEquals(
    estimatedJoinCost(entry(s, knows, o), dense(100, "s", "o"), {
      card: 0,
      bound: new Set(["s"]),
    }),
    0,
  );
});

Deno.test("boundVariables - collects the union of bound keys", () => {
  const bound = boundVariables([
    {
      s: namedNode("http://example.org/a"),
      o: namedNode("http://example.org/b"),
    },
    { z: namedNode("http://example.org/c") },
  ]);
  assertEquals([...bound].sort(), ["o", "s", "z"]);
});

Deno.test(
  "WazooSparqlEngine - the DP order never changes the result multiset",
  async () => {
    // A small two-shared-variable shape: 50 people (knows + name each), 25
    // spouse edges. The DP joins the shared pair first; the result must be
    // the same multiset as the written-order (reorder off) evaluation.
    const store = new Store();
    for (let index = 0; index < 50; index++) {
      const person = namedNode(`http://example.org/p${index}`);
      store.addQuad(
        quad(
          person,
          knows,
          namedNode(`http://example.org/p${(index + 1) % 50}`),
        ),
      );
      store.addQuad(quad(person, name, literal(`Name ${index}`)));
    }
    for (let index = 0; index < 25; index++) {
      store.addQuad(
        quad(
          namedNode(`http://example.org/z${index}`),
          spouse,
          namedNode(`http://example.org/w${index}`),
        ),
      );
    }
    const query = "SELECT * WHERE { ?s <http://example.org/knows> ?o . " +
      "?s <http://example.org/name> ?n . ?z <http://example.org/spouse> ?w }";

    const dpEngine = new WazooSparqlEngine({ store });
    const writtenEngine = new WazooSparqlEngine({
      store,
      reorderPatterns: false,
    });
    const dpResult = await dpEngine.execute({ query });
    const writtenResult = await writtenEngine.execute({ query });
    if (dpResult.kind !== "select" || writtenResult.kind !== "select") {
      throw new Error("expected select results");
    }
    const key = (b: Record<string, unknown>): string =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(b)
            .map(([k, v]) => [k, JSON.stringify(v)])
            .sort(),
        ),
      );
    const dpBindings = dpResult.data.results.bindings.map(key).sort();
    const writtenBindings = writtenResult.data.results.bindings.map(key).sort();
    assertEquals(dpBindings, writtenBindings);
    assertEquals(dpBindings.length, 50 * 25);
  },
);

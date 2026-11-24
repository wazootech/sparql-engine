import assert from "node:assert/strict";
import { test } from "node:test";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/public.ts";
import type { ScanEntry } from "@/evaluator/join.ts";
import { GraphScopedStore } from "@/quad-store.ts";
import {
  DISTINCT_SAMPLE_CAP,
  fallbackStats,
  patternSignature,
  PatternStatistics,
} from "@/planner/pattern-statistics.ts";
import type { PatternStats } from "@/planner/pattern-statistics.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad, variable, defaultGraph } = DataFactory;

const patternVar = variable("x");
const objectVar = variable("o");
const constantP = namedNode("http://example.org/p");

/** seedStore returns a store holding one quad per subject s0..s(n-1). */
function seedStore(count: number, store = new Store()): Store {
  for (let index = 0; index < count; index++) {
    store.addQuad(
      quad(
        namedNode(`http://example.org/s${index}`),
        constantP,
        literal(`v${index}`),
      ),
    );
  }
  return store;
}

/** entry builds a ScanEntry over ?x <p> ?o with the given candidates. */
function entry(candidates: rdfjs.Quad[]): ScanEntry {
  return {
    subject: patternVar,
    predicate: constantP,
    object: objectVar,
    candidates,
  };
}

/** statsStore wraps a MemoryStore with an estimateStats hook. */
function statsStore(
  store: Store,
  estimateStats: () => PatternStats | undefined,
): Store & { estimateStats: () => PatternStats | undefined } {
  return Object.assign(store, { estimateStats });
}

/** candidatesFor returns every quad of the store as an array. */
function candidatesFor(store: Store): rdfjs.Quad[] {
  return store.getQuads(null, null, null);
}

/** collectMatch drains a store view's match stream into an array. */
function collectMatch(store: rdfjs.Source<rdfjs.Quad>): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  store.match(null, null, null).on("data", (q: rdfjs.Quad) => quads.push(q));
  return quads;
}

test("patternSignature - distinguishes patterns by terms and shape", () => {
  const plain = entry([]);
  const reifies: ScanEntry = { ...plain, reifies: true };
  const tripleTerm: ScanEntry = { ...plain, tripleTermObject: true };
  assert.deepStrictEqual(
    patternSignature(plain),
    "(?x|uri:http://example.org/p|?o)",
  );
  assert.deepStrictEqual(
    patternSignature(reifies),
    "R(?x|uri:http://example.org/p|?o)",
  );
  assert.deepStrictEqual(
    patternSignature(tripleTerm),
    "T(?x|uri:http://example.org/p|?o)",
  );
});

test("PatternStatistics - hook supplies the stats and is cached", async () => {
  const store = seedStore(10);
  let calls = 0;
  const hooked = statsStore(store, () => {
    calls += 1;
    return { candidates: 10, distinctByVar: { x: 10, o: 10 } };
  });
  const source = new PatternStatistics(hooked);
  assert.deepStrictEqual(source.hasHook, true);

  const first = await source.statsFor(hooked, entry(candidatesFor(hooked)));
  assert.deepStrictEqual(first, {
    candidates: 10,
    distinctByVar: { x: 10, o: 10 },
  });
  const second = await source.statsFor(hooked, entry(candidatesFor(hooked)));
  assert.deepStrictEqual(second, first);
  // The cache absorbs the second request: the hook ran exactly once.
  assert.deepStrictEqual(calls, 1);
});

test("PatternStatistics - no hook falls back to the candidates scan", async () => {
  const store = seedStore(10);
  const source = new PatternStatistics(store);
  assert.deepStrictEqual(source.hasHook, false);

  const stats = await source.statsFor(store, entry(candidatesFor(store)));
  // Exact distinct counts: 10 subjects, 1 predicate, 10 distinct objects.
  assert.deepStrictEqual(stats, {
    candidates: 10,
    distinctByVar: { x: 10, o: 10 },
  });
});

test(
  "PatternStatistics - fallback agrees with the hook on identical data",
  async () => {
    const plain = seedStore(10);
    const candidates = candidatesFor(plain);

    // The hook answers with the exact numbers the fallback derives.
    const hooked = statsStore(
      seedStore(10),
      () => fallbackStats(entry(candidates)),
    );
    const fromHook = await new PatternStatistics(hooked).statsFor(
      hooked,
      entry(candidates),
    );
    const fromFallback = await new PatternStatistics(plain).statsFor(
      plain,
      entry(candidates),
    );
    assert.deepStrictEqual(fromHook, fromFallback);
  },
);

test(
  "PatternStatistics - a hook returning undefined selects the fallback",
  async () => {
    const store = seedStore(10);
    const hooked = statsStore(store, () => undefined);
    const stats = await new PatternStatistics(hooked).statsFor(
      hooked,
      entry(candidatesFor(hooked)),
    );
    assert.deepStrictEqual(stats.candidates, 10);
    assert.deepStrictEqual(stats.distinctByVar.o, 10);
  },
);

test(
  "PatternStatistics - named-graph scope never consults the hook",
  async () => {
    const store = seedStore(5);
    const hooked = statsStore(store, () => {
      throw new Error("hook must not be consulted in a named scope");
    });
    const source = new PatternStatistics(hooked);
    const graph = namedNode("http://example.org/g");
    const scoped = new GraphScopedStore(hooked, graph);
    const stats = await source.statsFor(
      scoped,
      entry(
        collectMatch(scoped as unknown as Parameters<typeof collectMatch>[0]),
      ),
    );
    // The scoped candidates are empty (all data is in the default graph),
    // so the exact fallback reports zero candidates — never the hook.
    assert.deepStrictEqual(stats, { candidates: 0, distinctByVar: {} });
  },
);

test(
  "PatternStatistics - default-graph scope sees through the GraphScopedStore view",
  async () => {
    const store = seedStore(5);
    let calls = 0;
    const hooked = statsStore(store, () => {
      calls += 1;
      return { candidates: 5, distinctByVar: { x: 5, o: 5 } };
    });
    const source = new PatternStatistics(hooked);
    // The default-scope view wraps the raw store; the hook must be visible
    // through it (mirroring version forwarding).
    const scoped = new GraphScopedStore(hooked, defaultGraph());
    const stats = await source.statsFor(
      scoped,
      entry(
        collectMatch(scoped as unknown as Parameters<typeof collectMatch>[0]),
      ),
    );
    assert.deepStrictEqual(stats, {
      candidates: 5,
      distinctByVar: { x: 5, o: 5 },
    });
    assert.deepStrictEqual(calls, 1);
  },
);

test("fallbackStats - bounded sample stays deterministic for large scans", () => {
  // 4x the cap: the stride samples every 4th candidate, so the distinct
  // counts are exact for uniform data (subjects/objects all unique).
  const count = DISTINCT_SAMPLE_CAP * 4;
  const stats = fallbackStats(entry(candidatesFor(seedStore(count))));
  assert.deepStrictEqual(stats.candidates, count);
  assert.deepStrictEqual(stats.distinctByVar.x, count);
  assert.deepStrictEqual(stats.distinctByVar.o, count);
});

test("fallbackStats - zero candidates reports empty stats", () => {
  const stats = fallbackStats(entry([]));
  assert.deepStrictEqual(stats, { candidates: 0, distinctByVar: {} });
});

test(
  "WazooSparqlEngine - a stats-providing store feeds the estimator without changing results",
  async () => {
    const store = seedStore(10);
    const hooked = statsStore(
      store,
      () => ({ candidates: 10, distinctByVar: { x: 10, o: 10 } }),
    );
    const engine = new WazooSparqlEngine({ store: hooked });
    const query =
      "SELECT ?x ?o WHERE { ?x <http://example.org/p> ?o . ?x ?p ?o }";
    const withHook = await engine.execute({ query });
    const withoutHook = await new WazooSparqlEngine({
      store: seedStore(10),
    }).execute({ query });
    assert.deepStrictEqual(withHook, withoutHook);
    assert.deepStrictEqual(withHook.kind, "select");
  },
);

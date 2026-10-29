import type * as rdfjs from "@rdfjs/types";
import { GraphScopedStore } from "@/quad-store.ts";
import type {
  PatternStats,
  StoreStatisticsHook,
} from "@/planner/pattern-stats-types.ts";
import type { ScanEntry } from "@/evaluator/join.ts";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";
import { fallbackStats } from "@/planner/fallback-stats.ts";
import { sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";
export type { PatternStats } from "@/planner/pattern-stats-types.ts";
export type { StoreStatisticsHook } from "@/planner/pattern-stats-types.ts";
export { DISTINCT_SAMPLE_CAP } from "@/planner/pattern-stats-types.ts";
export { fallbackStats } from "@/planner/fallback-stats.ts";

/**
 * patternSignature renders a stable cache key for a pattern: variables by
 * name, constants by term key, with markers for the reifies / triple-term
 * object join shapes (which scan differently than plain positional matches).
 */
export function patternSignature(entry: ScanEntry): string {
  const term = (t: SparqlTerm): string => {
    if (t.termType === "Variable" || t.termType === "BlankNode") {
      return `?${t.value}`;
    }
    if (t.termType === "Quad") {
      return `<<${term(t.subject)}|${term(t.predicate)}|${term(t.object)}>>`;
    }
    return termKey(sparqlTermToRdfTerm(t));
  };
  const shape = entry.reifies ? "R" : entry.tripleTermObject ? "T" : "";
  return `${shape}(${term(entry.subject)}|${term(entry.predicate)}|${
    term(entry.object)
  })`;
}

/**
 * PatternStatistics is the statistics source for one query evaluation. It
 * resolves PatternStats for a BGP pattern once per query, keyed by pattern
 * signature, so the greedy join-order loop in evaluateWithReordering never
 * re-derives them per step.
 *
 * Resolution order:
 *   1. A store exposing estimateStats supplies its own numbers (cached).
 *   2. Named-graph scopes (GRAPH) always derive from the pattern's scoped
 *      candidate scan — the store hook cannot see the scope, and the scoped
 *      candidates are exact for that graph.
 *   3. Otherwise the bounded fallback derives the same shape from the
 *      pattern's already-scanned candidates: the exact cardinality plus a
 *      distinct-value pass capped at DISTINCT_SAMPLE_CAP candidates (exact
 *      below the cap, a deterministic evenly-spaced sample above it), so
 *      large stores never pay an unbounded counting pass.
 */
export class PatternStatistics {
  private readonly cache = new Map<string, PatternStats>();

  private readonly hook: StoreStatisticsHook["estimateStats"];

  public constructor(store: rdfjs.Source<rdfjs.Quad>) {
    const candidate = (store as StoreStatisticsHook).estimateStats;
    this.hook = typeof candidate === "function"
      ? candidate.bind(store)
      : undefined;
  }

  /** hasHook reports whether the store exposes estimateStats. */
  public get hasHook(): boolean {
    return this.hook !== undefined;
  }

  /**
   * statsFor resolves the statistics for one scanned pattern within the
   * given store scope (see class doc for the resolution order). The scope is
   * the store view the pattern was scanned against; the result is cached by
   * pattern signature per scope kind.
   */
  public async statsFor(
    storeView: rdfjs.Source<rdfjs.Quad>,
    entry: ScanEntry,
  ): Promise<PatternStats> {
    const namedScope = storeView instanceof GraphScopedStore &&
      storeView.graph.termType !== "DefaultGraph";
    const key = `${namedScope ? "s" : "d"}::${patternSignature(entry)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const stats = await this.resolve(entry, namedScope);
    this.cache.set(key, stats);
    return stats;
  }

  private async resolve(
    entry: ScanEntry,
    namedScope: boolean,
  ): Promise<PatternStats> {
    if (
      !namedScope && this.hook !== undefined && !entry.reifies &&
      !entry.tripleTermObject
    ) {
      const fromHook = await this.hook({
        subject: entry.subject,
        predicate: entry.predicate,
        object: entry.object,
      });
      if (fromHook !== undefined) {
        return fromHook;
      }
    }
    return fallbackStats(entry);
  }
}

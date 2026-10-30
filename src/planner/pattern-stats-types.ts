import type { Triple } from "@/parser/sparql-parser.ts";

/**
 * PatternStats are the per-pattern statistics that feed the join-cost
 * estimator (planner piece 2, issue #129):
 *
 *   - candidates — how many quads the pattern matches in the store (the
 *     pattern's cardinality). For the default-graph scope this agrees with
 *     ScanEntry.candidates, which the join actually materializes;
 *   - distinctByVar — for each variable position of the pattern, how many
 *     distinct values that variable takes across the matched quads. This is
 *     the per-variable value-frequency that lets the estimator see true
 *     index bucket sizes, so two medium-selectivity patterns that share a
 *     variable are recognized as cheaper than unrelated patterns.
 *
 * Stats only ever influence join order — never results (SPARQL 1.1 §18.2.2).
 */
export interface PatternStats {
  candidates: number;
  distinctByVar: Partial<Record<string, number>>;
}

/**
 * StoreStatisticsHook is the optional store capability that feeds the
 * statistics source (mirroring the countQuads precedent, decision #12): a
 * store that can answer pattern-cardinality questions efficiently exposes
 * estimateStats, and the engine uses it when present, falling back to a
 * bounded derivation from the pattern's own candidate scan otherwise.
 *
 * The hook returns the statistics for the given triple pattern over the same
 * universe the store's match() exposes. A store whose data lives in the
 * default graph (the typical case) thus returns numbers that agree exactly
 * with the engine's fallback on identical data; a store with named-graph
 * data should scope its own answer accordingly. Returning undefined (or not
 * implementing the hook at all) selects the fallback for that pattern.
 */
export type StoreStatisticsHook = {
  estimateStats?(
    pattern: Triple,
  ): PatternStats | undefined | Promise<PatternStats | undefined>;
};

/** DISTINCT_SAMPLE_CAP bounds the fallback distinct-value pass. */
export const DISTINCT_SAMPLE_CAP = 1024;

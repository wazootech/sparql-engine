import type { ScanEntry, TermBinding } from "@/evaluator/join.ts";
import { termKey } from "@/term/mod.ts";

/**
 * JoinCostEstimator estimates the cost of joining one BGP triple pattern
 * against the current solution bindings. The estimate drives the greedy
 * join-order selection in BgpEvaluator.evaluateWithReordering — it must
 * never change results, only the order in which patterns are joined
 * (SPARQL 1.1 §18.2.2: joins commute, so every order yields the same
 * solution multiset).
 *
 * Contract: an estimator receives the pattern's ScanEntry — whose
 * candidates array holds the pattern's true store cardinality from the
 * up-front scan in evaluateWithReordering — plus the current bindings. It
 * may assume nothing else: no store access, and no statistics beyond the
 * entry's candidates (planner piece 2 adds an optional store statistics
 * hook that feeds richer per-pattern stats behind this same seam). The
 * estimator must be pure and deterministic: the same entry and bindings
 * always produce the same cost, and calling it must have no side effects.
 */
export interface JoinCostEstimator {
  /**
   * estimateJoinCost returns the estimated number of quad iterations
   * joining the given pattern against the current bindings will perform.
   * Lower is cheaper. A cost of 0 (for example, no bindings left to join)
   * is valid.
   */
  estimateJoinCost(entry: ScanEntry, bindings: TermBinding[]): number;
}

/**
 * BaselineJoinCostEstimator is the default JoinCostEstimator: the greedy
 * formula the engine shipped before the estimator seam existed, preserved
 * behavior-identical. Bindings that bind no pattern variable iterate every
 * candidate quad; bindings that bind a pattern variable probe the
 * positional index, costing roughly the average bucket size for the bound
 * variable with the fewest distinct bound values (candidate count divided
 * by that variable's distinct count) — a conservative per-binding bound.
 */
export class BaselineJoinCostEstimator implements JoinCostEstimator {
  /**
   * estimateJoinCost estimates the number of quad iterations joining the
   * given pattern against the current bindings will perform.
   */
  public estimateJoinCost(
    entry: ScanEntry,
    bindings: TermBinding[],
  ): number {
    if (bindings.length === 0) {
      return 0;
    }
    let mostSelectiveDistinct = Number.POSITIVE_INFINITY;
    for (const term of [entry.subject, entry.predicate, entry.object]) {
      if (term.termType !== "Variable") {
        continue;
      }
      const distinct = new Set<string>();
      for (const binding of bindings) {
        const value = binding[term.value];
        if (value !== undefined) {
          distinct.add(termKey(value));
        }
      }
      if (distinct.size === 0) {
        continue;
      }
      if (distinct.size < mostSelectiveDistinct) {
        mostSelectiveDistinct = distinct.size;
      }
    }
    if (mostSelectiveDistinct === Number.POSITIVE_INFINITY) {
      // No bound pattern variable: every binding iterates all candidates.
      return bindings.length * entry.candidates.length;
    }
    const averageBucket = Math.max(
      1,
      entry.candidates.length / mostSelectiveDistinct,
    );
    return bindings.length * averageBucket;
  }
}

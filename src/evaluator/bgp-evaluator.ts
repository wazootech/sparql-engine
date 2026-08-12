import type * as rdfjs from "@rdfjs/types";
import type { Expression, Pattern, Triple } from "sparqljs";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import { joinTriplePattern, scanEntry } from "@/evaluator/join.ts";
import type { ScanEntry, TermBinding } from "@/evaluator/join.ts";
import { termKey } from "@/term/mod.ts";

export type { TermBinding } from "@/evaluator/join.ts";

/**
 * BgpEvaluatorOptions configures BgpEvaluator.
 */
export interface BgpEvaluatorOptions {
  /**
   * reorderPatterns dynamically reorders BGP triple patterns by estimated
   * join cost before joining: each pattern is scanned once up front (the
   * hash join scans each pattern exactly once regardless of order), and the
   * pattern minimizing the estimated quad iterations against the current
   * bindings is joined next. The estimate combines the pattern's true store
   * cardinality with bound-variable selectivity, so a pattern whose variable
   * is already bound by earlier joins is processed early even when it has
   * many candidates. Defaults to true. Disabling it preserves written order
   * exactly.
   */
  reorderPatterns?: boolean;
}

/**
 * BgpEvaluator evaluates Basic Graph Patterns (BGPs) against an RDF/JS Store.
 * It is the pattern-sequence orchestrator: it flattens a group into triple
 * patterns and FILTER expressions, orders the patterns by estimated join
 * cost, delegates scanning and joining to the join module, and applies
 * filters to the resulting solutions.
 */
export class BgpEvaluator {
  private readonly reorderPatterns: boolean;

  /** expressionEvaluator evaluates FILTER expressions against solutions. */
  private readonly expressionEvaluator = new ExpressionEvaluator();

  public constructor(
    private readonly store: rdfjs.Store,
    options: BgpEvaluatorOptions = {},
  ) {
    this.reorderPatterns = options.reorderPatterns ?? true;
  }

  /**
   * evaluateBgp finds all variable bindings (as RDF/JS terms) matching the
   * given list of triple patterns.
   */
  public async evaluateBgp(patterns: Pattern[]): Promise<TermBinding[]> {
    // Flatten the triple patterns and FILTER expressions of the group. A
    // FILTER applies to every solution of the group regardless of its
    // position, so all joins run first and the filters are applied after.
    const triplePatterns: Triple[] = [];
    const filters: Expression[] = [];
    for (const pattern of patterns) {
      if (pattern.type === "bgp") {
        triplePatterns.push(...pattern.triples);
      } else if (pattern.type === "filter") {
        filters.push(pattern.expression);
      }
    }

    let bindings: TermBinding[];
    if (this.reorderPatterns && triplePatterns.length > 1) {
      bindings = await this.evaluateWithReordering(triplePatterns);
    } else {
      bindings = [{}];
      for (const triplePattern of triplePatterns) {
        bindings = joinTriplePattern(
          bindings,
          await scanEntry(this.store, triplePattern),
        );
      }
    }

    for (const filter of filters) {
      bindings = bindings.filter((binding) =>
        this.expressionEvaluator.filterPasses(filter, binding)
      );
    }
    return bindings;
  }

  /**
   * evaluateWithReordering scans every pattern once, then greedily joins the
   * pattern with the lowest estimated cost against the current bindings.
   */
  private async evaluateWithReordering(
    triplePatterns: Triple[],
  ): Promise<TermBinding[]> {
    const remaining = await Promise.all(
      triplePatterns.map((pattern) => scanEntry(this.store, pattern)),
    );

    let bindings: TermBinding[] = [{}];
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index++) {
        const cost = this.estimateJoinCost(remaining[index], bindings);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      }
      const [chosen] = remaining.splice(bestIndex, 1);
      bindings = joinTriplePattern(bindings, chosen);
    }
    return bindings;
  }

  /**
   * estimateJoinCost estimates the number of quad iterations joining the
   * given pattern against the current bindings will perform. Bindings that
   * bind no pattern variable iterate every candidate quad; bindings that bind
   * a pattern variable probe the positional index, costing roughly the
   * average bucket size for the most selective bound variable (candidate
   * count divided by its number of distinct bound values).
   */
  private estimateJoinCost(
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
      entry.candidates.length /
        mostSelectiveDistinct,
    );
    return bindings.length * averageBucket;
  }
}

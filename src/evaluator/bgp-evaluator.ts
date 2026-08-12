import type * as rdfjs from "@rdfjs/types";
import type { Expression, Pattern, Triple } from "sparqljs";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import {
  joinTriplePattern,
  leftJoin,
  minus,
  scanEntry,
} from "@/evaluator/join.ts";
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
 * BgpEvaluator evaluates SPARQL group graph patterns against an RDF/JS Store.
 * It is the pattern-sequence orchestrator: it walks a group's patterns left
 * to right threading solutions, delegating BGP joins to the join module and
 * combining pattern forms — OPTIONAL becomes a left join, MINUS a
 * shared-variable anti-join, FILTER an expression pass, and nested groups
 * recurse. Unsupported pattern types (UNION, GRAPH, SERVICE, BIND, VALUES)
 * raise a clear error rather than being silently dropped.
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
   * evaluateBgp evaluates a WHERE-clause pattern list from the empty
   * binding, producing all solution bindings (as RDF/JS terms).
   */
  public async evaluateBgp(patterns: Pattern[]): Promise<TermBinding[]> {
    return await this.evaluateGroup(patterns, [{}]);
  }

  /**
   * evaluateGroup threads the current solutions through a pattern list in
   * written order: each pattern transforms the binding set, so BGP joins
   * constrain it, FILTERs narrow it, OPTIONALs extend it, and MINUSes
   * eliminate it.
   */
  private async evaluateGroup(
    patterns: Pattern[],
    bindings: TermBinding[],
  ): Promise<TermBinding[]> {
    let result = bindings;
    for (const pattern of patterns) {
      result = await this.evaluatePattern(pattern, result);
    }
    return result;
  }

  /**
   * evaluatePattern applies a single graph pattern to the current solutions.
   */
  private async evaluatePattern(
    pattern: Pattern,
    bindings: TermBinding[],
  ): Promise<TermBinding[]> {
    switch (pattern.type) {
      case "bgp":
        return await this.joinBgp(pattern.triples, bindings);
      case "filter":
        return bindings.filter((binding) =>
          this.expressionEvaluator.filterPasses(pattern.expression, binding)
        );
      case "optional": {
        // The OPTIONAL group's own FILTER expressions are hoisted out and
        // evaluated against each merged binding (left joined with right), so
        // they may reference variables bound on either side — matching the
        // SPARQL LeftJoin(P1, P2, F) translation.
        const innerPatterns: Pattern[] = [];
        const filters: Expression[] = [];
        for (const inner of pattern.patterns) {
          if (inner.type === "filter") {
            filters.push(inner.expression);
          } else {
            innerPatterns.push(inner);
          }
        }
        const right = await this.evaluateGroup(innerPatterns, [{}]);
        return leftJoin(
          bindings,
          right,
          filters.map((expression) => (binding: TermBinding) =>
            this.expressionEvaluator.filterPasses(expression, binding)
          ),
        );
      }
      case "minus": {
        const right = await this.evaluateGroup(pattern.patterns, [{}]);
        return minus(bindings, right);
      }
      case "group":
        return await this.evaluateGroup(pattern.patterns, bindings);
      default:
        throw new Error(
          `Unsupported graph pattern type: ${(pattern as Pattern).type}`,
        );
    }
  }

  /**
   * joinBgp joins the current solutions against the triples of one BGP
   * block, optionally reordering the triples by estimated join cost.
   */
  private async joinBgp(
    triples: Triple[],
    bindings: TermBinding[],
  ): Promise<TermBinding[]> {
    if (this.reorderPatterns && triples.length > 1) {
      return await this.evaluateWithReordering(triples, bindings);
    }
    let result = bindings;
    for (const triple of triples) {
      result = joinTriplePattern(
        result,
        await scanEntry(this.store, triple),
      );
    }
    return result;
  }

  /**
   * evaluateWithReordering scans every pattern once, then greedily joins the
   * pattern with the lowest estimated cost against the current bindings.
   */
  private async evaluateWithReordering(
    triplePatterns: Triple[],
    bindings: TermBinding[],
  ): Promise<TermBinding[]> {
    const remaining = await Promise.all(
      triplePatterns.map((pattern) => scanEntry(this.store, pattern)),
    );

    let result = bindings;
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index++) {
        const cost = this.estimateJoinCost(remaining[index], result);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      }
      const [chosen] = remaining.splice(bestIndex, 1);
      result = joinTriplePattern(result, chosen);
    }
    return result;
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

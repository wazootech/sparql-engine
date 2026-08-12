import type * as rdfjs from "@rdfjs/types";
import type { Expression, Pattern, Triple } from "sparqljs";
import { DataFactory } from "n3";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import { GraphScopedStore, namedGraphs } from "@/quad-store.ts";

const { defaultGraph } = DataFactory;
import {
  innerJoin,
  isPropertyPath,
  joinPathPattern,
  joinTriplePattern,
  leftJoin,
  minus,
  scanEntry,
  scanPathEntry,
} from "@/evaluator/join.ts";
import type { ScanEntry, TermBinding } from "@/evaluator/join.ts";
import { sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";

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
 * shared-variable anti-join, UNION an evaluated-or branches case, FILTER
 * an expression pass, VALUES a natural join with a data block, BIND an
 * extend pass, GRAPH a graph-scoped evaluation over a scoped store view,
 * and nested groups recurse. Unsupported pattern types (SERVICE) raise a
 * clear error rather than being silently dropped.
 */
export class BgpEvaluator {
  private readonly reorderPatterns: boolean;

  /** expressionEvaluator evaluates FILTER expressions against solutions. */
  private readonly expressionEvaluator = new ExpressionEvaluator();

  public constructor(
    private readonly store: rdfjs.Source<rdfjs.Quad>,
    options: BgpEvaluatorOptions = {},
  ) {
    this.reorderPatterns = options.reorderPatterns ?? true;
  }

  /**
   * evaluateBgp evaluates a WHERE-clause pattern list from the empty
   * binding, producing all solution bindings (as RDF/JS terms).
   */
  public async evaluateBgp(patterns: Pattern[]): Promise<TermBinding[]> {
    // The top-level evaluation runs against the default graph (matching
    // Comunica, whose plain patterns never see named-graph quads); GRAPH
    // patterns scope further inside.
    const defaultScope = new GraphScopedStore(this.store, defaultGraph());
    return await this.evaluateGroup(patterns, [{}], defaultScope);
  }

  /**
   * forStore returns a fresh BgpEvaluator over the given store view with the
   * same options, used by SparqlEvaluator to evaluate a query against its
   * FROM / FROM NAMED dataset.
   */
  public forStore(store: rdfjs.Source<rdfjs.Quad>): BgpEvaluator {
    return new BgpEvaluator(store, {
      reorderPatterns: this.reorderPatterns,
    });
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
    store: rdfjs.Source<rdfjs.Quad>,
  ): Promise<TermBinding[]> {
    let result = bindings;
    for (const pattern of patterns) {
      result = await this.evaluatePattern(pattern, result, store);
    }
    return result;
  }

  /**
   * evaluatePattern applies a single graph pattern to the current solutions.
   */
  private async evaluatePattern(
    pattern: Pattern,
    bindings: TermBinding[],
    store: rdfjs.Source<rdfjs.Quad>,
  ): Promise<TermBinding[]> {
    switch (pattern.type) {
      case "bgp":
        return await this.joinBgp(pattern.triples, bindings, store);
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
        const right = await this.evaluateGroup(innerPatterns, [{}], store);
        return leftJoin(
          bindings,
          right,
          filters.map((expression) => (binding: TermBinding) =>
            this.expressionEvaluator.filterPasses(expression, binding)
          ),
        );
      }
      case "minus": {
        const right = await this.evaluateGroup(pattern.patterns, [{}], store);
        return minus(bindings, right);
      }
      case "union": {
        // Each branch evaluates independently over the graph; the union is
        // the multiset concatenation of the branches, naturally joined with
        // the incoming solutions — matching Join(P, Union(Q1, Q2)).
        const branchResults: TermBinding[][] = [];
        for (const branch of pattern.patterns) {
          branchResults.push(await this.evaluateGroup([branch], [{}], store));
        }
        return innerJoin(bindings, branchResults.flat());
      }
      case "values": {
        // VALUES data blocks are a multiset of rows naturally joined with
        // the incoming solutions (Join(P, Values(...))): a row's shared
        // variables must agree with the binding it extends, and duplicate
        // rows survive as duplicates.
        const rows: TermBinding[] = pattern.values.map((row) => {
          const binding: TermBinding = {};
          for (const name of Object.keys(row)) {
            const term = row[name];
            if (term !== undefined) {
              binding[name.slice(1)] = sparqlTermToRdfTerm(term);
            }
          }
          return binding;
        });
        return innerJoin(bindings, rows);
      }
      case "bind": {
        // BIND is Extend(P, var, expr) per SPARQL 1.1 §18.2.2.2: the
        // expression is evaluated per solution and the variable bound; an
        // evaluation error or a variable already bound (from an outer
        // scope) leaves the solution unchanged.
        return bindings.map((binding) => {
          const value = this.expressionEvaluator.evaluate(
            pattern.expression,
            binding,
          );
          if (
            value === undefined ||
            binding[pattern.variable.value] !== undefined
          ) {
            return binding;
          }
          return { ...binding, [pattern.variable.value]: value };
        });
      }
      case "graph": {
        // GRAPH <iri> evaluates the inner patterns against the named graph;
        // GRAPH ?g additionally enumerates every named graph in the store
        // and binds ?g to each. Both join naturally with the incoming
        // solutions. A fresh BgpEvaluator over the scoped store view keeps
        // the whole inner pipeline (joins, paths, OPTIONAL, MINUS, VALUES,
        // BIND, nested GRAPH) graph-scoped without any of them knowing.
        const graphName = pattern.name;
        if (
          graphName.termType !== "NamedNode" &&
          graphName.termType !== "Variable"
        ) {
          throw new Error(
            "Unsupported GRAPH name term type: " +
              (graphName as { termType: string }).termType,
          );
        }
        const graphTerms = graphName.termType === "Variable"
          ? await namedGraphs(this.store)
          : [sparqlTermToRdfTerm(graphName)];
        const results: TermBinding[] = [];
        for (const graphTerm of graphTerms) {
          const scopedStore = new GraphScopedStore(store, graphTerm);
          const inner = await this.evaluateGroup(
            pattern.patterns,
            [{}],
            scopedStore,
          );
          for (const binding of inner) {
            if (graphName.termType === "Variable") {
              binding[graphName.value] = graphTerm;
            }
            results.push(binding);
          }
        }
        return innerJoin(bindings, results);
      }
      case "group":
        return await this.evaluateGroup(pattern.patterns, bindings, store);
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
    store: rdfjs.Source<rdfjs.Quad>,
  ): Promise<TermBinding[]> {
    const hasPath = triples.some((triple) => isPropertyPath(triple.predicate));
    if (this.reorderPatterns && triples.length > 1 && !hasPath) {
      return await this.evaluateWithReordering(triples, bindings, store);
    }
    let result = bindings;
    for (const triple of triples) {
      if (isPropertyPath(triple.predicate)) {
        const entry = await scanPathEntry(
          store,
          triple.predicate,
          triple.subject,
          triple.object,
        );
        result = joinPathPattern(result, entry);
      } else {
        result = joinTriplePattern(
          result,
          await scanEntry(store, triple),
        );
      }
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
    store: rdfjs.Source<rdfjs.Quad>,
  ): Promise<TermBinding[]> {
    const remaining = await Promise.all(
      triplePatterns.map((pattern) => scanEntry(store, pattern)),
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

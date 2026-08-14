import type * as rdfjs from "@rdfjs/types";
import type { Expression, Pattern, Triple } from "@/parser/sparql-parser.ts";
import { DataFactory } from "@/term/mod.ts";
import {
  type ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import {
  buildQuadIndex,
  GraphScopedStore,
  matchQuads,
  namedGraphs,
  probeQuadIndex,
  type QuadIndex,
  simplePredicate,
} from "@/quad-store.ts";

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
  scanPathEntrySync,
} from "@/evaluator/join.ts";
import type { ScanEntry, TermBinding } from "@/evaluator/join.ts";
import { sameRdfTerm, sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";
import {
  expandReifiedTriples,
  isReifiesPattern,
  RDF_REIFIES,
} from "@/evaluator/reified.ts";

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

  /**
   * existsQuads and existsIndex are the drained, indexed snapshot of the
   * evaluator's store that the synchronous EXISTS hooks probe. They are
   * rebuilt per query by prepareExistsIndex when any pattern uses EXISTS.
   */
  private existsQuads: rdfjs.Quad[] | null = null;
  private existsIndex: QuadIndex | null = null;

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
    // EXISTS support: when any pattern in the tree uses EXISTS/NOT EXISTS,
    // the store's quads are drained once into a synchronous index that the
    // injected hooks probe (the decided sync-hook contract). Rebuilt per
    // query, so updates between queries never see a stale snapshot.
    this.existsIndex = null;
    this.existsQuads = null;
    if (patternListContainsExists(patterns)) {
      await this.prepareExistsIndex();
    }
    // The top-level evaluation runs against the default graph (matching
    // Comunica, whose plain patterns never see named-graph quads); GRAPH
    // patterns scope further inside.
    const defaultScope = this.store instanceof GraphScopedStore
      ? this.store
      : new GraphScopedStore(this.store, defaultGraph());
    return await this.evaluateGroup(patterns, [{}], defaultScope);
  }

  /**
   * prepareExistsIndex drains the evaluator's store into the synchronous
   * QuadIndex used by the EXISTS hooks. The SparqlEvaluator calls it for
   * projection / ORDER BY / HAVING expressions when they contain EXISTS even
   * though the WHERE clause does not.
   */
  public async prepareExistsIndex(): Promise<void> {
    if (this.existsIndex !== null) {
      return;
    }
    const quads = await matchQuads(this.store, null, null, null);
    this.existsQuads = quads;
    this.existsIndex = buildQuadIndex(quads);
  }

  /**
   * evaluateExists implements the injected pattern-evaluation hook: a group
   * pattern evaluated against one incoming solution, returning whether any
   * solution matches. Correlated (the solution's bindings are visible
   * inside), and only the boolean survives — inner bindings are discarded.
   * The graph parameter scopes the evaluation (the default graph at the top
   * level, the enclosing GRAPH's term inside one).
   */
  public evaluateExists(
    pattern: Pattern,
    solution: TermBinding,
    graph?: rdfjs.Term,
  ): boolean {
    if (this.existsIndex === null || this.existsQuads === null) {
      throw new Error(
        "EXISTS requires a prepared pattern index: call prepareExistsIndex() first",
      );
    }
    const scopeGraph = graph ?? defaultGraph();
    const candidates = this.existsQuads.filter((item) =>
      sameRdfTerm(item.graph, scopeGraph)
    );
    const patterns = pattern.type === "group" ? pattern.patterns : [pattern];
    return this.evaluateExistsGroup(
      patterns,
      [solution],
      candidates,
      scopeGraph,
    ).length > 0;
  }

  /**
   * evaluateExistsGroup threads solutions through a pattern list with the
   * synchronous exists evaluator, mirroring evaluateGroup for the pattern
   * forms the W3C EXISTS surface exercises (BGP, FILTER, GRAPH, BIND,
   * VALUES, OPTIONAL, MINUS, UNION, property paths, and nested EXISTS —
   * all over the graph-scoped candidate set, reusing the same join.ts
   * primitives as the main path). Only subqueries inside EXISTS still
   * raise a clear error rather than silently returning a wrong answer.
   */
  private evaluateExistsGroup(
    patterns: Pattern[],
    bindings: TermBinding[],
    candidates: rdfjs.Quad[],
    graph: rdfjs.Term,
  ): TermBinding[] {
    let result = bindings;
    for (const pattern of patterns) {
      result = this.evaluateExistsPattern(pattern, result, candidates, graph);
    }
    return result;
  }

  private evaluateExistsPattern(
    pattern: Pattern,
    bindings: TermBinding[],
    candidates: rdfjs.Quad[],
    graph: rdfjs.Term,
  ): TermBinding[] {
    const context: ExpressionEvaluationContext = {
      evaluateExists: (subPattern, solution) =>
        this.evaluateExists(subPattern, solution, graph),
    };
    switch (pattern.type) {
      case "bgp": {
        let result = bindings;
        for (const triple of expandReifiedTriples(pattern.triples)) {
          if (isPropertyPath(triple.predicate)) {
            // Property paths inside EXISTS evaluate synchronously over the
            // graph-scoped candidate set, mirroring the main-pattern
            // scanPathEntry semantics (pair dedup unless multiset, constant
            // endpoint pruning, reflexive closures over the scope's nodes).
            const entry = scanPathEntrySync(
              candidates,
              triple.predicate,
              triple.subject,
              triple.object,
            );
            result = joinPathPattern(result, entry);
            continue;
          }
          const predicate = simplePredicate(triple.predicate);
          const reifies = isReifiesPattern(predicate, triple.object);
          const tripleTermObject = !reifies &&
            triple.object.termType === "Quad";
          const entry: ScanEntry = {
            subject: triple.subject,
            predicate,
            object: triple.object,
            reifies,
            tripleTermObject,
            // probeQuadIndex checks only s/p/o, so the graph scope is
            // enforced afterwards over the probed candidates. Reifies
            // patterns scan every `rdf:reifies` statement in the scope, and
            // triple-term objects scan every quad with a triple-term object.
            candidates: reifies
              ? candidates.filter((item) =>
                item.predicate.termType === "NamedNode" &&
                item.predicate.value === RDF_REIFIES
              )
              : tripleTermObject
              ? candidates.filter((item) => item.object.termType === "Quad")
              : probeQuadIndex(
                this.existsIndex!,
                candidates,
                triple.subject.termType === "Variable"
                  ? null
                  : sparqlTermToRdfTerm(triple.subject),
                predicate.termType === "Variable"
                  ? null
                  : sparqlTermToRdfTerm(predicate),
                triple.object.termType === "Variable"
                  ? null
                  : sparqlTermToRdfTerm(triple.object),
              ).filter((item) => sameRdfTerm(item.graph, graph)),
          };
          result = joinTriplePattern(result, entry);
        }
        return result;
      }
      case "filter":
        return bindings.filter((binding) =>
          this.expressionEvaluator.filterPasses(
            pattern.expression,
            binding,
            context,
          )
        );
      case "graph": {
        const name = pattern.name;
        if (name.termType === "NamedNode") {
          const graphTerm = sparqlTermToRdfTerm(name);
          const scopedCandidates = this.existsQuads!.filter((item) =>
            sameRdfTerm(item.graph, graphTerm)
          );
          return this.evaluateExistsGroup(
            pattern.patterns,
            bindings,
            scopedCandidates,
            graphTerm,
          );
        }
        if (name.termType === "Variable") {
          // GRAPH ?g with ?g already bound from outside restricts the scope
          // to that graph (Join semantics); otherwise every named graph is
          // enumerated and ?g bound per match.
          const result: TermBinding[] = [];
          for (const binding of bindings) {
            const boundGraph = binding[name.value];
            if (boundGraph !== undefined) {
              const scopedCandidates = this.existsQuads!.filter((item) =>
                sameRdfTerm(item.graph, boundGraph)
              );
              result.push(
                ...this.evaluateExistsGroup(
                  pattern.patterns,
                  [binding],
                  scopedCandidates,
                  boundGraph,
                ),
              );
            } else {
              for (const graphTerm of namedGraphTerms(this.existsQuads!)) {
                const scopedCandidates = this.existsQuads!.filter((item) =>
                  sameRdfTerm(item.graph, graphTerm)
                );
                const inner = this.evaluateExistsGroup(
                  pattern.patterns,
                  [binding],
                  scopedCandidates,
                  graphTerm,
                );
                for (const innerBinding of inner) {
                  innerBinding[name.value] = graphTerm;
                  result.push(innerBinding);
                }
              }
            }
          }
          return result;
        }
        throw new Error(
          "Unsupported GRAPH name term type inside EXISTS: " +
            (name as { termType: string }).termType,
        );
      }
      case "bind":
        return bindings.map((binding) => {
          const value = this.expressionEvaluator.evaluate(
            pattern.expression,
            binding,
            context,
          );
          if (
            value === undefined ||
            binding[pattern.variable.value] !== undefined
          ) {
            return binding;
          }
          return { ...binding, [pattern.variable.value]: value };
        });
      case "values": {
        const rows: TermBinding[] = pattern.values.map((row) => {
          const binding: TermBinding = {};
          for (const rowName of Object.keys(row)) {
            const term = row[rowName];
            if (term !== undefined) {
              binding[rowName.slice(1)] = sparqlTermToRdfTerm(term);
            }
          }
          return binding;
        });
        return innerJoin(bindings, rows);
      }
      case "optional": {
        // The OPTIONAL group's own FILTER expressions are hoisted out and
        // evaluated against each merged binding (left joined with right), so
        // they may reference variables bound on either side — mirroring the
        // main path's LeftJoin(P1, P2, F) translation over the same join.ts
        // primitives.
        const innerPatterns: Pattern[] = [];
        const filters: Expression[] = [];
        for (const inner of pattern.patterns) {
          if (inner.type === "filter") {
            filters.push(inner.expression);
          } else {
            innerPatterns.push(inner);
          }
        }
        const right = this.evaluateExistsGroup(
          innerPatterns,
          [{}],
          candidates,
          graph,
        );
        return leftJoin(
          bindings,
          right,
          filters.map((expression) => (binding: TermBinding) =>
            this.expressionEvaluator.filterPasses(expression, binding, context)
          ),
        );
      }
      case "minus": {
        const right = this.evaluateExistsGroup(
          pattern.patterns,
          [{}],
          candidates,
          graph,
        );
        return minus(bindings, right);
      }
      case "union": {
        // Each branch evaluates independently over the graph scope; the union
        // is the multiset concatenation of the branches, naturally joined
        // with the incoming solutions — mirroring Join(P, Union(Q1, Q2)).
        const branchResults: TermBinding[][] = [];
        for (const branch of pattern.patterns) {
          branchResults.push(
            this.evaluateExistsGroup([branch], [{}], candidates, graph),
          );
        }
        return innerJoin(bindings, branchResults.flat());
      }
      case "group":
        // A nested { ... } block recurses over the same scope, mirroring the
        // main path's group case.
        return this.evaluateExistsGroup(
          pattern.patterns,
          bindings,
          candidates,
          graph,
        );
      case "query":
        throw new Error(
          `Graph pattern ${pattern.type} inside EXISTS is not supported yet`,
        );
      default:
        throw new Error(
          `Unsupported graph pattern inside EXISTS: ` +
            (pattern as { type: string }).type,
        );
    }
  }

  /**
   * existsContext builds the expression evaluation context bound to the
   * current graph scope of a group evaluation, for FILTER / BIND / OPTIONAL
   * conditions evaluated inside it.
   */
  private existsContext(
    store: rdfjs.Source<rdfjs.Quad>,
  ): ExpressionEvaluationContext {
    const graph = store instanceof GraphScopedStore
      ? store.graph
      : defaultGraph();
    return {
      evaluateExists: (pattern, solution) =>
        this.evaluateExists(pattern, solution, graph),
    };
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
    if (patternListContainsExists(patterns)) {
      await this.prepareExistsIndex();
    }
    const nonFilters: Pattern[] = [];
    const filters: Pattern[] = [];
    for (const p of patterns) {
      if (p.type === "filter") {
        filters.push(p);
      } else {
        nonFilters.push(p);
      }
    }
    let result = bindings;
    for (const pattern of nonFilters) {
      result = await this.evaluatePattern(pattern, result, store);
    }
    for (const filterPattern of filters) {
      result = await this.evaluatePattern(filterPattern, result, store);
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
      case "filter": {
        const context = this.existsContext(store);
        return bindings.filter((binding) =>
          this.expressionEvaluator.filterPasses(
            pattern.expression,
            binding,
            context,
          )
        );
      }
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
        if (filters.some(expressionContainsExists)) {
          await this.prepareExistsIndex();
        }
        const context = this.existsContext(store);
        return leftJoin(
          bindings,
          right,
          filters.map((expression) => (binding: TermBinding) =>
            this.expressionEvaluator.filterPasses(expression, binding, context)
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
        const context = this.existsContext(store);
        return bindings.map((binding) => {
          const value = this.expressionEvaluator.evaluate(
            pattern.expression,
            binding,
            context,
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
        const innerPatterns: Pattern[] = pattern.patterns ?? [
          {
            type: "bgp",
            triples: (pattern as unknown as { triples: Triple[] }).triples,
          },
        ];
        for (const graphTerm of graphTerms) {
          const scopedStore = new GraphScopedStore(store, graphTerm);
          const inner = await this.evaluateGroup(
            innerPatterns,
            [{}],
            scopedStore,
          );
          for (const binding of inner) {
            if (graphName.termType === "Variable") {
              const existing = binding[graphName.value];
              if (existing !== undefined && !sameRdfTerm(existing, graphTerm)) {
                continue;
              }
              results.push({ ...binding, [graphName.value]: graphTerm });
            } else {
              results.push(binding);
            }
          }
        }
        return innerJoin(bindings, results);
      }
      case "group": {
        const groupResult = await this.evaluateGroup(
          pattern.patterns,
          [{}],
          store,
        );
        return innerJoin(bindings, groupResult);
      }
      case "service": {
        const silent = Boolean(pattern.silent);
        try {
          const inner = await this.evaluateGroup(pattern.patterns, [{}], store);
          return innerJoin(bindings, inner);
        } catch (err) {
          if (silent) return bindings;
          throw err;
        }
      }
      case "query": {
        const { SparqlEvaluator } = await import(
          "@/evaluator/sparql-evaluator.ts"
        );
        const subEvaluator = new SparqlEvaluator(store, {
          reorderPatterns: this.reorderPatterns,
        });
        const subResults = await subEvaluator.evaluateSelectTermBindings(
          pattern as unknown as import("@/parser/sparql-parser.ts").SelectQuery,
        );
        return innerJoin(bindings, subResults);
      }
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
    // Reified-triple patterns (`<< s p o >>`, annotation `{| ... |}`) expand
    // into plain `rdf:reifies` triples before any scanning or reordering.
    const expanded = expandReifiedTriples(triples);
    const hasPath = expanded.some((triple) => isPropertyPath(triple.predicate));
    if (this.reorderPatterns && expanded.length > 1 && !hasPath) {
      return await this.evaluateWithReordering(expanded, bindings, store);
    }
    let result = bindings;
    for (const triple of expanded) {
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

/**
 * patternListContainsExists reports whether any pattern in the list (recursing
 * into OPTIONAL / MINUS / UNION / GRAPH / group bodies) contains an EXISTS or
 * NOT EXISTS expression. It drives prepareExistsIndex so the synchronous
 * EXISTS index is built exactly when a query needs it.
 */
export function patternListContainsExists(
  patterns: Pattern[] | undefined,
): boolean {
  return patterns?.some(patternContainsExists) ?? false;
}

function patternContainsExists(pattern: Pattern): boolean {
  switch (pattern.type) {
    case "bgp":
    case "values":
      return false;
    case "filter":
    case "bind":
      return expressionContainsExists(pattern.expression);
    case "optional":
    case "minus":
    case "union":
    case "graph":
    case "group":
      return patternListContainsExists(
        pattern.patterns ??
            (pattern as unknown as { triples?: Triple[] }).triples
          ? []
          : [],
      );
    case "query":
      return patternListContainsExists(
        (pattern as unknown as { where: Pattern[] }).where ?? [],
      );
    default:
      return false;
  }
}

/**
 * expressionContainsExists reports whether an expression tree contains an
 * EXISTS or NOT EXISTS operator, used by the SparqlEvaluator to prepare the
 * EXISTS index for projection / ORDER BY / HAVING expressions even when the
 * WHERE clause itself has none.
 */
export function expressionContainsExists(expression: Expression): boolean {
  if ("termType" in expression || !("type" in expression)) {
    return false;
  }
  if (expression.type === "operation") {
    if (
      expression.operator === "exists" ||
      expression.operator === "notexists"
    ) {
      return true;
    }
    return expression.args.some((arg) =>
      expressionContainsExists(arg as Expression)
    );
  }
  if (expression.type === "functionCall") {
    return expression.args.some(expressionContainsExists);
  }
  if (expression.type === "aggregate") {
    return (
      expression.expression !== undefined &&
      expressionContainsExists(expression.expression as Expression)
    );
  }
  return false;
}

/**
 * namedGraphTerms returns every named graph term present in the drained quad
 * snapshot (the synchronous twin of namedGraphs, for the EXISTS evaluator).
 */
function namedGraphTerms(quads: rdfjs.Quad[]): rdfjs.Quad_Graph[] {
  const graphs = new Map<string, rdfjs.Quad_Graph>();
  for (const item of quads) {
    if (item.graph.termType !== "DefaultGraph") {
      graphs.set(termKey(item.graph), item.graph);
    }
  }
  return [...graphs.values()];
}

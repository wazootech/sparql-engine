import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  AskQuery,
  ConstructQuery,
  Expression,
  Pattern,
  SelectQuery,
  SparqlQuery,
  Term as SparqlTerm,
} from "sparqljs";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlResponse,
  SparqlSelectResults,
} from "@/sparql-engine-interface.ts";
import { aggregateValue, groupSolutions } from "@/evaluator/aggregate.ts";
import { innerJoin } from "@/evaluator/join.ts";
import { BgpEvaluator } from "@/evaluator/bgp-evaluator.ts";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import { buildDatasetStore, simplePredicate } from "@/quad-store.ts";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import {
  canonicalizeSparqlValue,
  compareRdfTerms,
  rdfTermToSparqlValue,
  sparqlTermToRdfTerm,
} from "@/term/mod.ts";
import { DataFactory } from "n3";

/**
 * SparqlEvaluatorOptions configures SparqlEvaluator.
 */
export interface SparqlEvaluatorOptions {
  /**
   * reorderPatterns statically sorts BGP triple patterns by selectivity before
   * joining. Defaults to true. See BgpEvaluatorOptions.reorderPatterns.
   */
  reorderPatterns?: boolean;
}

/**
 * SelectSolution is one SELECT output row: the binding to project plus,
 * when the query has GROUP BY, the group's raw solutions that aggregates
 * resolve over (null when ungrouped).
 */
type SelectSolution = {
  binding: TermBinding;
  group: TermBinding[] | null;
};

/**
 * SparqlEvaluator processes parsed SPARQL AST queries against an RDFJS store.
 */
export class SparqlEvaluator {
  private readonly bgpEvaluator: BgpEvaluator;

  /** expressionEvaluator evaluates ORDER BY expressions against solutions. */
  private readonly expressionEvaluator = new ExpressionEvaluator();

  private readonly store: rdfjs.Source<rdfjs.Quad>;

  public constructor(
    store: rdfjs.Source<rdfjs.Quad>,
    options: SparqlEvaluatorOptions = {},
  ) {
    this.store = store;
    this.bgpEvaluator = new BgpEvaluator(store, {
      reorderPatterns: options.reorderPatterns,
    });
  }

  /**
   * bgpEvaluatorFor returns the evaluator for a query's WHERE clause: the
   * shared one when the query has no FROM / FROM NAMED clauses, otherwise a
   * fresh evaluator over the materialized active dataset (SPARQL 1.1 §13.1:
   * FROM graphs merge into the default graph, FROM NAMED graphs become the
   * dataset's named graphs).
   */
  private async bgpEvaluatorFor(
    from: { default: SparqlTerm[]; named: SparqlTerm[] } | undefined,
  ): Promise<BgpEvaluator> {
    if (
      from === undefined ||
      (from.default.length === 0 && from.named.length === 0)
    ) {
      return this.bgpEvaluator;
    }
    const dataset = await buildDatasetStore(
      this.store,
      from.default.map((term) => sparqlTermToRdfTerm(term)),
      from.named.map((term) => sparqlTermToRdfTerm(term)),
    );
    return this.bgpEvaluator.forStore(dataset);
  }

  /**
   * evaluateQuery processes a parsed SPARQL query and produces a typed SparqlResponse.
   */
  public async evaluateQuery(query: SparqlQuery): Promise<SparqlResponse> {
    switch (query.type) {
      case "query":
        switch (query.queryType) {
          case "SELECT":
            return { kind: "select", data: await this.evaluateSelect(query) };
          case "ASK":
            return { kind: "ask", data: await this.evaluateAsk(query) };
          case "CONSTRUCT":
            return {
              kind: "construct",
              data: await this.evaluateConstruct(query),
            };
          default:
            throw new Error(`Unsupported query type: ${query.queryType}`);
        }
      default:
        throw new Error(`Unsupported SPARQL operation type: ${query.type}`);
    }
  }

  private async evaluateSelect(
    query: SelectQuery,
  ): Promise<SparqlSelectResults> {
    let rawBindings = await (await this.bgpEvaluatorFor(query.from))
      .evaluateBgp(query.where || []);

    // A post-query VALUES clause joins the WHERE result with its rows
    // (SPARQL 1.1 §18.2.5: Join(G, ToMultiSet(VALUES))): a solution survives
    // exactly when some row is compatible with it on the shared variables,
    // and the row's bindings extend it.
    if (query.values !== undefined && query.values.length > 0) {
      const rows: TermBinding[] = query.values.map((row) => {
        const binding: TermBinding = {};
        for (const name of Object.keys(row)) {
          const term = row[name];
          if (term !== undefined) {
            binding[name.slice(1)] = sparqlTermToRdfTerm(term);
          }
        }
        return binding;
      });
      rawBindings = innerJoin(rawBindings, rows);
    }
    const vars: string[] = [];
    const projections = new Map<string, Expression>();
    let wildcard = false;

    for (const v of query.variables) {
      if (typeof v === "string") {
        vars.push(v);
      } else if ("termType" in v && v.termType === "Variable") {
        vars.push(v.value);
      } else if ("variable" in v && v.variable) {
        vars.push(v.variable.value);
        projections.set(v.variable.value, v.expression);
      } else {
        // SELECT * — sparqljs represents the wildcard as an empty object.
        wildcard = true;
      }
    }

    // GROUP BY partitions the raw solutions; each partition becomes one
    // solution carrying its group's raw solutions so aggregate expressions
    // in projection, HAVING, and ORDER BY resolve over the group. When
    // aggregates appear without GROUP BY, the whole solution set is the one
    // implicit group (SPARQL 1.1 §18.2.4.2).
    const grouping = query.group ?? [];
    const hasGrouping = grouping.length > 0;
    const hasAggregates =
      [...projections.values()].some((expression) =>
        expressionContainsAggregate(expression)
      ) ||
      (query.order ?? []).some((clause) =>
        expressionContainsAggregate(clause.expression)
      ) ||
      (query.having ?? []).some(expressionContainsAggregate);
    let solutions: SelectSolution[];
    if (hasGrouping || hasAggregates) {
      const groups = hasGrouping
        ? groupSolutions(
          rawBindings,
          grouping,
          (expression, binding) =>
            this.expressionEvaluator.evaluate(expression, binding),
        )
        : [{ key: {}, solutions: rawBindings }];
      const grouped: SelectSolution[] = groups.map((group) => ({
        binding: group.key,
        group: group.solutions,
      }));
      solutions = query.having !== undefined && query.having.length > 0
        ? grouped.filter((solution) =>
          query.having!.every((expression) =>
            this.havingPasses(expression, solution)
          )
        )
        : grouped;
    } else {
      solutions = rawBindings.map((binding) => ({
        binding,
        group: null,
      }));
    }

    const ordered = query.order?.length
      ? this.orderBindings(solutions, query.order)
      : solutions;

    // Bindings travel internally as RDF/JS terms; this projection is the
    // single point where they become the SparqlValue wire format. Projection
    // expressions ((expr AS ?v)) are evaluated here — with aggregate
    // resolution when the solution carries a group — and an error leaves the
    // variable unbound, matching SPARQL 1.1 semantics. The wildcard projects
    // every variable the solution binds.
    const projected: SparqlBinding[] = ordered.map((solution) =>
      this.projectSolution(solution, wildcard, vars, projections)
    );

    // Solution modifiers apply after projection, per SPARQL 1.1 §18.2.5:
    // DISTINCT removes duplicate projected solutions, then LIMIT/OFFSET
    // slice the sequence.
    let filteredBindings = projected;
    if (query.distinct) {
      filteredBindings = deduplicateBindings(filteredBindings);
    }
    if (query.offset !== undefined) {
      filteredBindings = filteredBindings.slice(query.offset);
    }
    if (query.limit !== undefined) {
      filteredBindings = filteredBindings.slice(0, query.limit);
    }

    return {
      head: {
        vars: wildcard
          ? Array.from(
            new Set(projected.flatMap((binding) => Object.keys(binding))),
          )
          : vars,
      },
      results: { bindings: filteredBindings },
    };
  }

  /**
   * havingPasses applies one HAVING expression to a grouped solution: the
   * expression is evaluated with aggregate resolution over the group and
   * its EBV must be true (false and errors both drop the group).
   */
  private havingPasses(
    expression: Expression,
    solution: SelectSolution,
  ): boolean {
    if (solution.group === null) {
      return false;
    }
    return this.expressionEvaluator.filterPassesWithAggregates(
      expression,
      solution.binding,
      this.aggregateResolver(solution),
    );
  }

  /**
   * aggregateResolver returns the aggregate resolver for a grouped solution:
   * each aggregate expression evaluates over the group's raw solutions.
   */
  private aggregateResolver(
    solution: SelectSolution,
  ): (aggregate: AggregateExpression) => rdfjs.Term | undefined {
    const group = solution.group;
    if (group === null) {
      return () => undefined;
    }
    return (aggregate) =>
      aggregateValue(
        aggregate,
        group,
        (expression, binding) =>
          this.expressionEvaluator.evaluate(expression, binding),
      );
  }

  /**
   * projectSolution renders one solution (raw or grouped) to the wire
   * format. Projected variables resolve from the solution's binding (group
   * key variables are bound by grouping); projection expressions evaluate
   * with the solution's aggregate resolver when it is grouped.
   */
  private projectSolution(
    solution: SelectSolution,
    wildcard: boolean,
    vars: string[],
    projections: Map<string, Expression>,
  ): SparqlBinding {
    const binding = solution.binding;
    const result: SparqlBinding = {};
    if (wildcard) {
      for (const varName of Object.keys(binding)) {
        result[varName] = rdfTermToSparqlValue(binding[varName]);
      }
      return result;
    }
    const resolver = solution.group === null
      ? undefined
      : this.aggregateResolver(solution);
    for (const varName of vars) {
      const bound = binding[varName];
      if (bound) {
        result[varName] = rdfTermToSparqlValue(bound);
      }
      const projection = projections.get(varName);
      if (projection !== undefined && !(varName in result)) {
        const value = resolver === undefined
          ? this.expressionEvaluator.evaluate(projection, binding)
          : this.expressionEvaluator.evaluateWithAggregates(
            projection,
            binding,
            resolver,
          );
        if (value !== undefined) {
          result[varName] = rdfTermToSparqlValue(value);
        }
      }
    }
    return result;
  }

  private async evaluateAsk(query: AskQuery): Promise<SparqlAskResults> {
    const bindings = await (await this.bgpEvaluatorFor(query.from))
      .evaluateBgp(query.where || []);
    return {
      head: { link: null },
      boolean: bindings.length > 0,
    };
  }

  private async evaluateConstruct(
    query: ConstructQuery,
  ): Promise<SparqlConstructResults> {
    const bindings = await (await this.bgpEvaluatorFor(query.from))
      .evaluateBgp(query.where || []);
    const quads: rdfjs.Quad[] = [];

    if (!query.template) {
      return { quads };
    }

    for (const binding of bindings) {
      for (const t of query.template) {
        const s = this.resolveConstructTerm(t.subject, binding);
        const p = this.resolveConstructTerm(
          simplePredicate(t.predicate),
          binding,
        );
        const o = this.resolveConstructTerm(t.object, binding);

        if (s && p && o) {
          quads.push(
            DataFactory.quad(
              s as rdfjs.Quad_Subject,
              p as rdfjs.Quad_Predicate,
              o as rdfjs.Quad_Object,
              DataFactory.defaultGraph(),
            ),
          );
        }
      }
    }

    return { quads };
  }

  /**
   * orderBindings sorts term bindings by the query's ORDER BY clauses, using
   * the term module's ordering (unbound lowest, then blank nodes, IRIs, and
   * literals; literals by datatype, numeric value, then lexical form).
   * Comparison is stable, so ties keep the evaluation order. Only variable
   * and constant-term expressions are supported; anything else (function
   * calls, arithmetic) has no expression evaluator yet and raises a clear
   * error.
   */
  private orderBindings(
    solutions: SelectSolution[],
    order: NonNullable<SelectQuery["order"]>,
  ): SelectSolution[] {
    const comparators = order.map((clause) => ({
      descending: clause.descending === true,
      resolve: (solution: SelectSolution): rdfjs.Term | undefined => {
        const resolver = solution.group === null
          ? undefined
          : this.aggregateResolver(solution);
        return resolver === undefined
          ? this.expressionEvaluator.evaluate(
            clause.expression,
            solution.binding,
          )
          : this.expressionEvaluator.evaluateWithAggregates(
            clause.expression,
            solution.binding,
            resolver,
          );
      },
    }));
    return [...solutions].sort((a, b) => {
      for (const comparator of comparators) {
        const result = compareRdfTerms(
          comparator.resolve(a),
          comparator.resolve(b),
        );
        if (result !== 0) {
          return comparator.descending ? -result : result;
        }
      }
      return 0;
    });
  }

  private resolveConstructTerm(
    term: SparqlTerm,
    binding: TermBinding,
  ): rdfjs.Term | null {
    if (term.termType === "Variable") {
      const bound = binding[term.value];
      if (bound) {
        return bound;
      }
      return null;
    }
    return sparqlTermToRdfTerm(term);
  }
}

/**
 * deduplicateBindings removes duplicate projected solutions, comparing each
 * value by its canonical form (so identical terms in different wire shapes
 * collapse).
 */
function deduplicateBindings(bindings: SparqlBinding[]): SparqlBinding[] {
  const seen = new Set<string>();
  const result: SparqlBinding[] = [];
  for (const binding of bindings) {
    const key = Object.keys(binding)
      .sort()
      .map((name) =>
        `${name}=${JSON.stringify(canonicalizeSparqlValue(binding[name]))}`
      )
      .join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(binding);
    }
  }
  return result;
}

/**
 * expressionContainsAggregate reports whether an expression tree contains an
 * aggregate node (COUNT, SUM, ...) anywhere inside it.
 */
function expressionContainsAggregate(
  expression: Expression | Pattern,
): boolean {
  if ("termType" in expression) {
    return false;
  }
  if (!("type" in expression)) {
    return false;
  }
  if (expression.type === "aggregate") {
    return true;
  }
  if (expression.type === "operation") {
    return expression.args.some(expressionContainsAggregate);
  }
  if (expression.type === "functionCall") {
    return expression.args.some(expressionContainsAggregate);
  }
  return false;
}

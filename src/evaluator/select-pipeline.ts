import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  Expression,
  SelectQuery,
  VariableExpression,
} from "@/parser/sparql-parser.ts";
import { aggregateValue, groupSolutions } from "@/evaluator/aggregate.ts";
import { innerJoin } from "@/evaluator/join.ts";
import type { TermBinding } from "@/evaluator/join.ts";
import type {
  ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import {
  expressionContainsAggregate,
  expressionContainsExists,
} from "@/evaluator/expression-utils.ts";
import { compareRdfTerms, sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";

/**
 * SelectSolution is one SELECT output row: the binding to project plus,
 * when the query has GROUP BY, the group's raw solutions that aggregates
 * resolve over (null when ungrouped).
 */
export type SelectSolution = {
  binding: TermBinding;
  group: TermBinding[] | null;
};

/**
 * pipelineNeedsExistsIndex reports whether any expression in the query's
 * projection, ORDER BY, or HAVING clauses contains an EXISTS/NOT EXISTS, in
 * which case the caller must prepare the synchronous EXISTS index before
 * applying the pipeline.
 */
export function pipelineNeedsExistsIndex(query: SelectQuery): boolean {
  const projections = query.variables.filter(
    (v): v is VariableExpression =>
      typeof v === "object" && "variable" in v && Boolean(v.variable),
  );
  return projections.some((v) => expressionContainsExists(v.expression)) ||
    (query.order ?? []).some((clause) =>
      expressionContainsExists(clause.expression)
    ) ||
    (query.having ?? []).some(expressionContainsExists);
}

/**
 * applySelectPipeline turns a query's raw BGP solutions into its final
 * projected term bindings: VALUES join, GROUP BY / aggregates, HAVING,
 * ORDER BY, projection, DISTINCT/REDUCED dedup, OFFSET, and LIMIT. It is
 * fully synchronous — the WHERE evaluation is the caller's job — so it is
 * shared by the async SparqlEvaluator (which evaluates the WHERE over the
 * store) and the synchronous EXISTS subquery path (which evaluates it over
 * the graph-scoped candidate snapshot). One pipeline, both call sites.
 *
 * Prior art: the stage order — VALUES as a natural join, GROUP BY /
 * aggregates, HAVING, ORDER BY, projection, then DISTINCT/REDUCED and
 * OFFSET/LIMIT — follows the SPARQL 1.1 evaluation order (§18.2.4–§18.5)
 * over the formal algebra of Pérez, Arenas & Gutierrez.
 * @see {@link https://www.w3.org/TR/sparql11-query/ Harris & Seaborne (eds.), "SPARQL 1.1 Query Language," W3C Recommendation, 2013}
 * @see {@link https://doi.org/10.1145/1567274.1567278 Pérez, Arenas & Gutierrez, "Semantics and Complexity of SPARQL," ACM TODS 34(3), 2009, art. 16}
 */
export function applySelectPipeline(
  rawBindings: TermBinding[],
  query: SelectQuery,
  expressionEvaluator: ExpressionEvaluator,
  context: ExpressionEvaluationContext,
): TermBinding[] {
  let bindings = rawBindings;

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
    // The join now emits incrementally (issue #74); the select pipeline's
    // grouping/ordering steps are inherently materializing, so the streaming
    // left is collected here.
    bindings = [...innerJoin(bindings, rows)];
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
      wildcard = true;
    }
  }

  const grouping = query.group ?? [];
  const hasGrouping = grouping.length > 0;
  const hasAggregates =
    [...projections.values()].some(expressionContainsAggregate) ||
    (query.order ?? []).some((clause) =>
      expressionContainsAggregate(clause.expression)
    ) ||
    (query.having ?? []).some(expressionContainsAggregate);

  let solutions: SelectSolution[];
  if (hasGrouping || hasAggregates) {
    const groups = hasGrouping
      ? groupSolutions(
        bindings,
        grouping,
        (expression, binding) =>
          expressionEvaluator.evaluate(expression, binding, context),
      )
      : [{ key: {}, solutions: bindings }];
    const grouped: SelectSolution[] = groups.map((group) => ({
      binding: group.key,
      group: group.solutions,
    }));
    solutions = query.having !== undefined && query.having.length > 0
      ? grouped.filter((solution) =>
        query.having!.every((expression) =>
          havingPasses(expression, solution, expressionEvaluator, context)
        )
      )
      : grouped;
  } else {
    solutions = bindings.map((binding) => ({ binding, group: null }));
  }

  const ordered = query.order?.length
    ? orderBindings(solutions, query.order, expressionEvaluator, context)
    : solutions;

  const projected: TermBinding[] = ordered.map((solution) =>
    projectSolutionToTermBinding(
      solution,
      wildcard,
      vars,
      projections,
      expressionEvaluator,
      context,
    )
  );

  let filteredBindings = projected;
  // REDUCED is a permitted hint to drop duplicates; per the REDUCED decision
  // it is implemented as full dedup (REDUCED ≡ DISTINCT), which is strictly
  // stronger than the spec floor and matches Comunica/Oxigraph on ≤100-
  // distinct inputs.
  if (query.distinct || query.reduced) {
    const seen = new Set<string>();
    filteredBindings = filteredBindings.filter((b) => {
      const key = Object.keys(b).sort().map((k) => `${k}:${termKey(b[k])}`)
        .join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (query.offset !== undefined) {
    filteredBindings = filteredBindings.slice(query.offset);
  }
  if (query.limit !== undefined) {
    filteredBindings = filteredBindings.slice(0, query.limit);
  }
  return filteredBindings.map((b) => {
    const clean: TermBinding = {};
    for (const k of Object.keys(b)) {
      if (!k.startsWith("_:")) {
        clean[k] = b[k];
      }
    }
    return clean;
  });
}

/**
 * havingPasses applies one HAVING expression to a grouped solution: the
 * expression is evaluated with aggregate resolution over the group and its
 * EBV must be true (false and errors both drop the group).
 */
function havingPasses(
  expression: Expression,
  solution: SelectSolution,
  expressionEvaluator: ExpressionEvaluator,
  context?: ExpressionEvaluationContext,
): boolean {
  if (solution.group === null) {
    return false;
  }
  return expressionEvaluator.filterPassesWithAggregates(
    expression,
    solution.binding,
    aggregateResolver(solution, expressionEvaluator, context),
    context,
  );
}

/**
 * aggregateResolver returns the aggregate resolver for a grouped solution:
 * each aggregate expression evaluates over the group's raw solutions.
 */
function aggregateResolver(
  solution: SelectSolution,
  expressionEvaluator: ExpressionEvaluator,
  context?: ExpressionEvaluationContext,
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
        expressionEvaluator.evaluate(expression, binding, context),
    );
}

/**
 * projectSolutionToTermBinding renders one solution (raw or grouped) to its
 * projected binding. Projected variables resolve from the solution's binding
 * (group key variables are bound by grouping); projection expressions
 * evaluate with the solution's aggregate resolver when it is grouped.
 */
function projectSolutionToTermBinding(
  solution: SelectSolution,
  wildcard: boolean,
  vars: string[],
  projections: Map<string, Expression>,
  expressionEvaluator: ExpressionEvaluator,
  context?: ExpressionEvaluationContext,
): TermBinding {
  const binding = solution.binding;
  const result: TermBinding = {};
  if (wildcard) {
    for (const varName of Object.keys(binding)) {
      result[varName] = binding[varName];
    }
    return result;
  }
  // BNODE(str) scopes its blank nodes to a single solution mapping, so each
  // solution's projection carries a fresh bnode cache (SPARQL 1.1 §17.4.1.5).
  const solutionContext: ExpressionEvaluationContext = {
    ...(context ?? {}),
    bnodeMap: new Map<string, rdfjs.BlankNode>(),
  };
  const resolver = solution.group === null
    ? undefined
    : aggregateResolver(solution, expressionEvaluator, solutionContext);
  for (const varName of vars) {
    const bound = binding[varName];
    if (bound) {
      result[varName] = bound;
    }
    const projection = projections.get(varName);
    if (projection !== undefined && !(varName in result)) {
      const mergedBinding = { ...binding, ...result };
      const value = resolver === undefined
        ? expressionEvaluator.evaluate(
          projection,
          mergedBinding,
          solutionContext,
        )
        : expressionEvaluator.evaluateWithAggregates(
          projection,
          mergedBinding,
          resolver,
          solutionContext,
        );
      if (value !== undefined) {
        result[varName] = value;
      }
    }
  }
  return result;
}

/**
 * orderBindings sorts term bindings by the query's ORDER BY clauses, using
 * the term module's ordering (unbound lowest, then blank nodes, IRIs, and
 * literals; literals by datatype, numeric value, then lexical form, with
 * rdf:dirLangString values tie-broken by base direction). Comparison is
 * stable, so ties keep the evaluation order. Any expression the expression
 * evaluator supports (variables, constants, builtin function calls) can be
 * sorted on; genuinely unsupported expressions raise a clear error.
 */
function orderBindings(
  solutions: SelectSolution[],
  order: NonNullable<SelectQuery["order"]>,
  expressionEvaluator: ExpressionEvaluator,
  context?: ExpressionEvaluationContext,
): SelectSolution[] {
  const comparators = order.map((clause) => ({
    descending: clause.descending === true,
    resolve: (solution: SelectSolution): rdfjs.Term | undefined => {
      const resolver = solution.group === null
        ? undefined
        : aggregateResolver(solution, expressionEvaluator, context);
      return resolver === undefined
        ? expressionEvaluator.evaluate(
          clause.expression,
          solution.binding,
          context,
        )
        : expressionEvaluator.evaluateWithAggregates(
          clause.expression,
          solution.binding,
          resolver,
          context,
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

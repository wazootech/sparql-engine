import type * as rdfjs from "@rdfjs/types";
import type { Expression, SelectQuery } from "@/parser/sparql-parser.ts";
import type {
  ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import type { SelectSolution } from "@/evaluator/select-solution.ts";
import { aggregateResolver } from "@/evaluator/select-resolver.ts";
import { compareRdfTerms } from "@/term/mod.ts";

/**
 * orderBindings sorts term bindings by the query's ORDER BY clauses, using
 * the term module's ordering (unbound lowest, then blank nodes, IRIs, and
 * literals; literals by datatype, numeric value, then lexical form, with
 * rdf:dirLangString values tie-broken by base direction). Comparison is
 * stable, so ties keep the evaluation order. Any expression the expression
 * evaluator supports (variables, constants, builtin function calls) can be
 * sorted on; genuinely unsupported expressions raise a clear error.
 *
 * A bare reference to a SELECT `(expression AS ?v)` alias (issue #201) sorts
 * by the alias's value: the alias is bound by the projection-conversion
 * Extend (§18.2.4.4) before ORDER BY runs (§18.2.5.1), so the comparator
 * evaluates the alias's expression over the solution — with aggregate
 * resolution for grouped solutions — instead of reading the (absent)
 * projected binding.
 */
export function orderBindings(
  solutions: SelectSolution[],
  order: NonNullable<SelectQuery["order"]>,
  expressionEvaluator: ExpressionEvaluator,
  context?: ExpressionEvaluationContext,
  projectionAliasMap: Map<string, Expression> = new Map(),
): SelectSolution[] {
  const aliasValue = (
    solution: SelectSolution,
    alias: Expression,
  ): rdfjs.Term | undefined => {
    const resolver = solution.group === null
      ? undefined
      : aggregateResolver(solution, expressionEvaluator, context);
    return resolver === undefined
      ? expressionEvaluator.evaluate(alias, solution.binding, context)
      : expressionEvaluator.evaluateWithAggregates(
        alias,
        solution.binding,
        resolver,
        context,
      );
  };
  const comparators = order.map((clause) => ({
    descending: clause.descending === true,
    resolve: (solution: SelectSolution): rdfjs.Term | undefined => {
      if (
        "termType" in clause.expression &&
        clause.expression.termType === "Variable"
      ) {
        const alias = projectionAliasMap.get(clause.expression.value);
        if (alias !== undefined) {
          return aliasValue(solution, alias);
        }
      }
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

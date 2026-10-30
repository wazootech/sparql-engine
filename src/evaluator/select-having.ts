import type {
  Expression,
  SelectQuery,
  VariableExpression,
} from "@/parser/sparql-parser.ts";
import type {
  ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import type { SelectSolution } from "@/evaluator/select-solution.ts";
import { aggregateResolver } from "@/evaluator/select-resolver.ts";
import { expressionContainsExists } from "@/evaluator/expression-utils.ts";

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
 * havingPasses applies one HAVING expression to a grouped solution: the
 * expression is evaluated with aggregate resolution over the group and its
 * EBV must be true (false and errors both drop the group).
 */
export function havingPasses(
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

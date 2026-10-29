import type * as rdfjs from "@rdfjs/types";
import type { AggregateExpression } from "@/parser/sparql-parser.ts";
import type {
  ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import type { SelectSolution } from "@/evaluator/select-solution.ts";
import { aggregateValue } from "@/evaluator/aggregate.ts";

/**
 * aggregateResolver returns the aggregate resolver for a grouped solution:
 * each aggregate expression evaluates over the group's raw solutions.
 */
export function aggregateResolver(
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

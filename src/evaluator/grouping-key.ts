import type { Expression, Grouping } from "@/parser/sparql-parser.ts";

/**
 * groupingKeyVariableName is the variable name stored in a GROUP BY partition
 * key when the grouping uses AS ?v or the expression is a bare ?v.
 */
export function groupingKeyVariableName(
  grouping: Grouping,
): string | undefined {
  if (grouping.variable !== undefined) {
    return grouping.variable.value;
  }
  return groupingExpressionVariableName(grouping.expression);
}

/** groupingExpressionVariableName returns ?v when the expression is a variable. */
export function groupingExpressionVariableName(
  expression: Expression,
): string | undefined {
  if ("termType" in expression && expression.termType === "Variable") {
    return expression.value;
  }
  return undefined;
}

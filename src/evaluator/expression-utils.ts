import type { Expression, Pattern } from "@/parser/sparql-parser.ts";
import type { TermBinding } from "@/evaluator/join.ts";

/**
 * expressionContainsExists reports whether an expression tree contains an
 * EXISTS or NOT EXISTS operator, used to prepare the synchronous EXISTS index
 * for projection / ORDER BY / HAVING expressions even when the WHERE clause
 * itself has none.
 */
export function expressionContainsExists(expression: Expression): boolean {
  if ("termType" in expression || !("type" in expression)) {
    return false;
  }
  if (expression.type === "exists") {
    return true;
  }
  if (expression.type === "membership") {
    return (
      expressionContainsExists(expression.subject) ||
      expression.candidates.some(expressionContainsExists)
    );
  }
  if (expression.type === "operation") {
    // Narrows the argument union to its expression arm once: scriptc has no
    // representation for `some` over a union of array types.
    const args: Expression[] = expression.args;
    for (const arg of args) {
      if (expressionContainsExists(arg)) {
        return true;
      }
    }
    return false;
  }
  if (expression.type === "functionCall") {
    return expression.args.some(expressionContainsExists);
  }
  if (expression.type === "aggregate") {
    if (expression.wildcard === true) {
      return false;
    }
    return (
      expression.expression !== undefined &&
      expressionContainsExists(expression.expression as Expression)
    );
  }
  return false;
}

/**
 * expressionContainsAggregate reports whether an expression tree contains an
 * aggregate node (COUNT, SUM, ...) anywhere inside it.
 */
export function expressionContainsAggregate(
  expression: Expression | Expression[] | Pattern,
): boolean {
  if (Array.isArray(expression) || "termType" in expression) {
    return false;
  }
  if (!("type" in expression)) {
    return false;
  }
  if (expression.type === "aggregate") {
    return true;
  }
  if (expression.type === "exists") {
    return false;
  }
  if (expression.type === "membership") {
    return (
      expressionContainsAggregate(expression.subject) ||
      expression.candidates.some(expressionContainsAggregate)
    );
  }
  if (expression.type === "operation") {
    // Narrows the argument union to its expression arm once: scriptc has no
    // representation for `some` over a union of array types.
    const args: Expression[] = expression.args;
    for (const arg of args) {
      if (expressionContainsAggregate(arg)) {
        return true;
      }
    }
    return false;
  }
  if (expression.type === "functionCall") {
    return expression.args.some(expressionContainsAggregate);
  }
  return false;
}

/**
 * expressionUsesUnboundVariable reports whether any variable the expression
 * reads is unbound in the solution. EXISTS patterns are not read.
 */
export function expressionUsesUnboundVariable(
  expression: Expression,
  binding: TermBinding,
): boolean {
  if ("termType" in expression) {
    return (
      expression.termType === "Variable" &&
      binding[expression.value] === undefined
    );
  }
  if (!("type" in expression)) {
    return false;
  }
  let args: Expression[] = [];
  if (expression.type === "operation") {
    args = expression.args as Expression[];
  } else if (expression.type === "functionCall") {
    args = expression.args as Expression[];
  } else if (expression.type === "membership") {
    args = [expression.subject, ...expression.candidates];
  }
  for (const arg of args) {
    if (expressionUsesUnboundVariable(arg, binding)) {
      return true;
    }
  }
  return false;
}

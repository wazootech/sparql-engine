/**
 * sparql-scope.ts collects the variables an AST fragment brings into scope or
 * uses (SPARQL 1.1 §18.2.1), for the parser's validation pass.
 */

import type { Expression, Pattern, Term } from "@/parser/ast.ts";

/** addTermVariables adds a term's variables, including a triple term's. */
export function addTermVariables(term: Term, into: Set<string>): undefined {
  if (term.termType === "Variable") {
    into.add(term.value);
  } else if (term.termType === "Quad") {
    addTermVariables(term.subject as Term, into);
    addTermVariables(term.predicate as Term, into);
    addTermVariables(term.object as Term, into);
  }
}

/** childExpressions lists an expression's direct sub-expressions. */
export function childExpressions(expression: Expression): Expression[] {
  if ("termType" in expression) {
    return [];
  }
  if (expression.type === "operation" || expression.type === "functionCall") {
    return expression.args;
  }
  if (expression.type === "membership") {
    const children: Expression[] = [expression.subject];
    for (const candidate of expression.candidates) {
      children.push(candidate);
    }
    return children;
  }
  return [];
}

/** addUngrouped adds the variables an expression uses outside aggregates. */
export function addUngrouped(
  expression: Expression,
  into: Set<string>,
): undefined {
  if ("termType" in expression) {
    addTermVariables(expression, into);
    return;
  }
  for (const child of childExpressions(expression)) {
    addUngrouped(child, into);
  }
}

/** containsAggregate reports whether an expression aggregates. */
export function containsAggregate(expression: Expression): boolean {
  if ("type" in expression && expression.type === "aggregate") {
    return true;
  }
  for (const child of childExpressions(expression)) {
    if (containsAggregate(child)) {
      return true;
    }
  }
  return false;
}

/** addInScope adds the variables a pattern brings into scope. */
export function addInScope(pattern: Pattern, into: Set<string>): undefined {
  if (pattern.type === "bgp") {
    for (const triple of pattern.triples) {
      addTermVariables(triple.subject, into);
      if ("termType" in triple.predicate) {
        addTermVariables(triple.predicate, into);
      }
      addTermVariables(triple.object, into);
    }
  } else if (pattern.type === "bind") {
    into.add(pattern.variable.value);
  } else if (pattern.type === "values") {
    for (const row of pattern.values) {
      for (const key of Object.keys(row)) {
        into.add(key.slice(1));
      }
    }
  } else if (
    pattern.type === "group" ||
    pattern.type === "optional" ||
    pattern.type === "union"
  ) {
    addAllInScope(pattern.patterns, into);
  } else if (pattern.type === "graph" || pattern.type === "service") {
    addTermVariables(pattern.name, into);
    addAllInScope(pattern.patterns, into);
  } else if (pattern.type === "query") {
    // A subquery exposes only what it projects.
    for (const item of pattern.variables) {
      if ("variable" in item) {
        into.add(item.variable.value);
      } else if (item.termType === "Variable") {
        into.add(item.value);
      } else {
        addAllInScope(pattern.where ?? [], into);
      }
    }
  }
  // FILTER and MINUS bring nothing into scope.
}

/** addAllInScope adds the variables a pattern list brings into scope. */
export function addAllInScope(
  patterns: Pattern[],
  into: Set<string>,
): undefined {
  for (const pattern of patterns) {
    addInScope(pattern, into);
  }
}

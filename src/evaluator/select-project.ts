import type * as rdfjs from "@rdfjs/types";
import type { Expression, SelectQuery } from "@/parser/sparql-parser.ts";
import type {
  ExpressionEvaluationContext,
  ExpressionEvaluator,
} from "@/evaluator/expression-evaluator.ts";
import type { SelectSolution } from "@/evaluator/select-solution.ts";
import type { TermBinding } from "@/evaluator/join.ts";
import { aggregateResolver } from "@/evaluator/select-resolver.ts";

/**
 * projectionAliases collects the SELECT clause's `(expression AS ?v)`
 * projections as a variable-name-to-expression map. The same map drives
 * projection (applySelectPipeline) and ORDER BY alias resolution: per
 * SPARQL 1.1 §18.2.4.4 the alias is bound by the projection-conversion
 * Extend, which happens before the solution modifiers (§18.2.5), so a bare
 * alias reference in ORDER BY sorts by the projected value.
 */
export function projectionAliases(query: SelectQuery): Map<string, Expression> {
  const aliases = new Map<string, Expression>();
  for (const v of query.variables) {
    if ("variable" in v && v.variable) {
      aliases.set(v.variable.value, v.expression);
    }
  }
  return aliases;
}

/**
 * projectSolutionToTermBinding renders one solution (raw or grouped) to its
 * projected binding. Projected variables resolve from the solution's binding
 * (group key variables are bound by grouping); projection expressions
 * evaluate with the solution's aggregate resolver when it is grouped.
 */
export function projectSolutionToTermBinding(
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

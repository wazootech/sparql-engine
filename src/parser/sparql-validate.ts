/**
 * sparql-validate.ts walks a parsed request and rejects what the grammar
 * accepts but SPARQL forbids: rebinding a variable, aggregates outside
 * SELECT / HAVING / ORDER BY, a blank node label shared between basic graph
 * patterns, and a builtin called with the wrong number of arguments.
 */

import type { Expression, Pattern, Query, UpdateQuery } from "@/parser/ast.ts";
import { addInScope, childExpressions } from "@/parser/sparql-scope.ts";
import { validateProjection } from "@/parser/sparql-validate-projection.ts";
import {
  type BlankNodeBlocks,
  checkArity,
  claimBlankNodes,
} from "@/parser/sparql-validate-terms.ts";

/** validateRequest throws when a query or update breaks one of those rules. */
export function validateRequest(request: Query | UpdateQuery): undefined {
  if (request.type !== "update") {
    validateQuery(request, { count: 0, owners: new Map<string, number>() });
    return;
  }
  for (const operation of request.updates) {
    if ("where" in operation && operation.where !== undefined) {
      walkPatterns(operation.where, {
        count: 0,
        owners: new Map<string, number>(),
      });
    }
  }
}

function validateQuery(query: Query, blocks: BlankNodeBlocks): undefined {
  walkPatterns(query.where ?? [], blocks);
  for (const grouping of query.group ?? []) {
    walkExpression(grouping.expression, false, blocks);
  }
  for (const ordering of query.order ?? []) {
    walkExpression(ordering.expression, true, blocks);
  }
  for (const condition of query.having ?? []) {
    walkExpression(condition, true, blocks);
  }
  if (query.queryType === "SELECT") {
    for (const item of query.variables) {
      if ("expression" in item) {
        walkExpression(item.expression, true, blocks);
      }
    }
    validateProjection(query);
  }
}

// walkPatterns visits one group's patterns in order, tracking the variables in
// scope (for BIND) and the basic graph pattern that is open: only a FILTER may
// sit between two triple blocks of the same one.
function walkPatterns(patterns: Pattern[], blocks: BlankNodeBlocks): undefined {
  const scope = new Set<string>();
  let open = 0;
  for (const pattern of patterns) {
    if (pattern.type === "bgp") {
      if (open === 0) {
        blocks.count += 1;
        open = blocks.count;
      }
      claimBlankNodes(pattern.triples, open, blocks);
    } else if (pattern.type === "filter") {
      walkExpression(pattern.expression, false, blocks);
    } else {
      open = 0;
      if (pattern.type === "bind") {
        if (scope.has(pattern.variable.value)) {
          throw new Error(
            "Variable used to bind is already bound (?" +
              pattern.variable.value +
              ")",
          );
        }
        walkExpression(pattern.expression, false, blocks);
      } else if (pattern.type === "union") {
        for (const branch of pattern.patterns) {
          walkPatterns(
            branch.type === "group" ? branch.patterns : [branch],
            blocks,
          );
        }
      } else if (pattern.type === "query") {
        validateQuery(pattern, blocks);
      } else if (
        pattern.type === "group" ||
        pattern.type === "optional" ||
        pattern.type === "minus" ||
        pattern.type === "graph" ||
        pattern.type === "service"
      ) {
        walkPatterns(pattern.patterns, blocks);
      }
    }
    addInScope(pattern, scope);
  }
}

function walkExpression(
  expression: Expression,
  aggregates: boolean,
  blocks: BlankNodeBlocks,
): undefined {
  if ("termType" in expression) {
    return;
  }
  if (expression.type === "aggregate") {
    if (!aggregates) {
      throw new Error(
        "Aggregates are only allowed in SELECT, HAVING, and ORDER BY clauses",
      );
    }
    if (expression.wildcard !== true) {
      walkExpression(expression.expression as Expression, false, blocks);
    }
    return;
  }
  if (expression.type === "exists") {
    walkPatterns(expression.patterns, blocks);
    return;
  }
  if (expression.type === "operation") {
    checkArity(expression);
  }
  for (const child of childExpressions(expression)) {
    walkExpression(child, aggregates, blocks);
  }
}

/**
 * sparql-validate-projection.ts checks a SELECT clause: a grouped query may
 * project only grouped variables and earlier aliases, and `AS` must introduce
 * a variable that is not already in use (SPARQL 1.1 §11.4, §18.2.1).
 */

import type { SelectQuery } from "@/parser/ast.ts";
import {
  addAllInScope,
  addUngrouped,
  containsAggregate,
} from "@/parser/sparql-scope.ts";

/** validateProjection throws when the SELECT clause breaks those rules. */
export function validateProjection(query: SelectQuery): undefined {
  const grouped = isGrouped(query);
  const keys = groupKeys(query);
  const scope = new Set<string>();
  addAllInScope(query.where ?? [], scope);
  for (const row of query.values ?? []) {
    for (const key of Object.keys(row)) {
      scope.add(key.slice(1));
    }
  }
  const aliases = new Set<string>();
  const mentioned = new Set<string>();
  for (const item of query.variables) {
    if ("variable" in item) {
      const used = new Set<string>();
      addUngrouped(item.expression, used);
      for (const name of used) {
        if (grouped && !keys.has(name) && !aliases.has(name)) {
          throw new Error(
            "Use of ungrouped variable in projection of operation (?" +
              name +
              ")",
          );
        }
        mentioned.add(name);
      }
      const alias = item.variable.value;
      if (scope.has(alias) || mentioned.has(alias)) {
        throw new Error(
          "Target id of 'AS' (?" + alias + ") is already in scope",
        );
      }
      aliases.add(alias);
      mentioned.add(alias);
    } else if (item.termType === "Variable") {
      if (grouped && !keys.has(item.value)) {
        throw new Error(
          "Projection of ungrouped variable (?" + item.value + ")",
        );
      }
      mentioned.add(item.value);
    } else if (grouped) {
      throw new Error("SELECT * cannot be used with GROUP BY or aggregates");
    }
  }
}

// A query is grouped when it says so or aggregates anywhere.
function isGrouped(query: SelectQuery): boolean {
  if (query.group !== undefined) {
    return true;
  }
  for (const item of query.variables) {
    if ("variable" in item && containsAggregate(item.expression)) {
      return true;
    }
  }
  for (const condition of query.having ?? []) {
    if (containsAggregate(condition)) {
      return true;
    }
  }
  for (const ordering of query.order ?? []) {
    if (containsAggregate(ordering.expression)) {
      return true;
    }
  }
  return false;
}

// The variables GROUP BY makes available: aliases and plain variables.
function groupKeys(query: SelectQuery): Set<string> {
  const keys = new Set<string>();
  for (const grouping of query.group ?? []) {
    if (grouping.variable !== undefined) {
      keys.add(grouping.variable.value);
    } else if ("termType" in grouping.expression) {
      keys.add(grouping.expression.value);
    }
  }
  return keys;
}

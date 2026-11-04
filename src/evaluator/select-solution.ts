import type { TermBinding } from "@/evaluator/join.ts";

/**
 * SelectSolution is one SELECT output row: the binding to project plus,
 * when the query has GROUP BY, the group's raw solutions that aggregates
 * resolve over (null when ungrouped).
 */
export type SelectSolution = {
  binding: TermBinding;
  group: TermBinding[] | null;
};

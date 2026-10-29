import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  Expression,
  Grouping,
} from "@/parser/sparql-parser.ts";
import { termKey } from "@/term/mod.ts";
import type { TermBinding } from "@/evaluator/join.ts";
import {
  groupConcat,
  isAggregateWildcard,
  minMaxAggregate,
  solutionKey,
  WILDCARD_MARKER,
} from "@/evaluator/aggregate-helpers.ts";
import {
  avgAggregate,
  integerLiteral,
  sumAggregate,
} from "@/evaluator/aggregate-numeric.ts";

/**
 * SolutionGroup is one GROUP BY partition: the group's key binding (the
 * group expressions' values) and the raw solutions it was formed from,
 * which the aggregates evaluate over.
 */
export type SolutionGroup = {
  key: TermBinding;
  solutions: TermBinding[];
};

/**
 * groupSolutions partitions solutions by the GROUP BY expressions: two
 * solutions share a group exactly when every group expression evaluates to
 * the same value (undefined values group together). The key binding carries
 * each group expression's value under its variable when the expression is a
 * variable or carries an AS ?v alias; bare expressions only partition.
 *
 * Prior art: partitioning by a hashed group key (each solution hashes its
 * group-expression values and appends to the matching bucket) is
 * hash-based grouping/aggregation, the classic main-memory aggregation
 * strategy.
 * @see {@link https://doi.org/10.1145/152610.152611 Graefe, "Query Evaluation Techniques for Large Databases," ACM Computing Surveys 25(2), 1993, pp. 73–170}
 */
export function groupSolutions(
  solutions: TermBinding[],
  grouping: Grouping[],
  evaluate: (
    expression: Expression,
    binding: TermBinding,
  ) => rdfjs.Term | undefined,
): SolutionGroup[] {
  const groups = new Map<string, SolutionGroup>();
  for (const solution of solutions) {
    const key: TermBinding = {};
    const parts: string[] = [];
    for (const entry of grouping) {
      const expr = ("expression" in entry && entry.expression)
        ? entry.expression
        : (entry as unknown as Expression);
      const value = evaluate(expr, solution);
      const varName = ("variable" in entry && entry.variable)
        ? entry.variable.value
        : ("termType" in expr && expr.termType === "Variable"
          ? expr.value
          : undefined);
      if (varName !== undefined && value !== undefined) {
        key[varName] = value;
      }
      parts.push(value === undefined ? "\u0001" : termKey(value));
    }
    const groupKey = parts.join("\u0002");
    let group = groups.get(groupKey);
    if (group === undefined) {
      group = { key, solutions: [] };
      groups.set(groupKey, group);
    }
    group.solutions.push(solution);
  }
  return [...groups.values()];
}

/**
 * aggregateValue computes one aggregate over a group's raw solutions. The
 * contract is Comunica's observable behavior, pinned differentially: COUNT
 * returns the count of defined argument values (all solutions for COUNT(*));
 * SUM/AVG promote numerically (integer stays exact via BigInt, decimal and
 * double follow XPath promotion) and are unbound when any bound argument is
 * non-numeric; empty SUM/AVG/COUNT are the integer 0; MIN/MAX use term
 * ordering; SAMPLE is the first defined value; GROUP_CONCAT joins the string
 * forms of defined values with the separator (default a single space) and is
 * "" when nothing is defined. DISTINCT pre-deduplicates argument values (or
 * whole solutions for DISTINCT *).
 */
export function aggregateValue(
  aggregate: AggregateExpression,
  solutions: TermBinding[],
  evaluate: (
    expression: Expression,
    binding: TermBinding,
  ) => rdfjs.Term | undefined,
): rdfjs.Term | undefined {
  const wildcard = isAggregateWildcard(aggregate.expression);
  if (wildcard && aggregate.aggregation !== "count") {
    throw new Error(
      `Unsupported aggregate over *: ${aggregate.aggregation}`,
    );
  }
  const values: (rdfjs.Term | undefined)[] = [];
  const distinctSeen = new Set<string>();
  for (const solution of solutions) {
    let value: rdfjs.Term | undefined;
    let key: string;
    if (wildcard) {
      value = WILDCARD_MARKER;
      key = solutionKey(solution);
    } else {
      // The wildcard check is a runtime test (sparqljs emits {} for it);
      // TS still sees the union, so narrow with a cast.
      value = evaluate(aggregate.expression as Expression, solution);
      key = value === undefined ? "\u0001" : termKey(value);
    }
    if (aggregate.distinct) {
      if (distinctSeen.has(key)) {
        continue;
      }
      distinctSeen.add(key);
    }
    values.push(value);
  }
  const defined = values.filter((v) => v !== undefined) as rdfjs.Term[];

  switch (aggregate.aggregation) {
    case "count":
      return integerLiteral(defined.length);
    case "sum":
      return sumAggregate(defined);
    case "avg":
      return avgAggregate(defined);
    case "min":
    case "max":
      return minMaxAggregate(aggregate.aggregation, defined);
    case "sample":
      return defined.length === 0 ? undefined : defined[0];
    case "group_concat":
      return groupConcat(aggregate.separator, defined);
    default:
      throw new Error(`Unsupported aggregate: ${aggregate.aggregation}`);
  }
}

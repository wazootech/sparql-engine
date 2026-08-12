import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  Expression,
  Grouping,
  Wildcard,
} from "sparqljs";
import { DataFactory } from "n3";
import type { TermBinding } from "@/evaluator/join.ts";
import {
  canonicalDouble,
  compareRdfTerms,
  formatNumber,
  numericValue,
  termKey,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
  XSD_STRING,
} from "@/term/mod.ts";

const { literal, namedNode } = DataFactory;

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
      const value = evaluate(entry.expression, solution);
      const varName = entry.variable?.value ??
        ("termType" in entry.expression &&
            entry.expression.termType === "Variable"
          ? entry.expression.value
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

function sumAggregate(defined: rdfjs.Term[]): rdfjs.Term | undefined {
  if (defined.length === 0) {
    return integerLiteral(0);
  }
  let datatype = XSD_INTEGER;
  const nums: (number | bigint)[] = [];
  for (const value of defined) {
    if (value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    nums.push(numeric);
    const dt = value.datatype?.value ?? "";
    if (dt === XSD_DOUBLE) {
      datatype = XSD_DOUBLE;
    } else if (dt === XSD_FLOAT && datatype !== XSD_DOUBLE) {
      datatype = XSD_FLOAT;
    } else if (dt === XSD_DECIMAL && datatype === XSD_INTEGER) {
      datatype = XSD_DECIMAL;
    }
  }
  if (datatype === XSD_INTEGER && nums.every((n) => typeof n === "bigint")) {
    let total = 0n;
    for (const n of nums) {
      total += n as bigint;
    }
    return integerLiteral(total);
  }
  let total = 0;
  for (const n of nums) {
    total += Number(n);
  }
  return numericLiteral(total, datatype);
}

function avgAggregate(defined: rdfjs.Term[]): rdfjs.Term | undefined {
  if (defined.length === 0) {
    return integerLiteral(0);
  }
  let datatype = XSD_DECIMAL;
  let total = 0;
  for (const value of defined) {
    if (value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    total += Number(numeric);
    const dt = value.datatype?.value ?? "";
    if (dt === XSD_DOUBLE || dt === XSD_FLOAT) {
      datatype = XSD_DOUBLE;
    }
  }
  return numericLiteral(total / defined.length, datatype);
}

function minMaxAggregate(
  aggregation: "min" | "max",
  defined: rdfjs.Term[],
): rdfjs.Term | undefined {
  if (defined.length === 0) {
    return undefined;
  }
  let best = defined[0];
  for (const value of defined) {
    const comparison = compareRdfTerms(value, best);
    if (aggregation === "min" ? comparison < 0 : comparison > 0) {
      best = value;
    }
  }
  return best;
}

function groupConcat(
  separator: string | undefined,
  defined: rdfjs.Term[],
): rdfjs.Term {
  const parts: string[] = [];
  for (const value of defined) {
    if (value.termType === "Literal" || value.termType === "NamedNode") {
      parts.push(value.value);
    }
    // Blank nodes have no string form per SPARQL str(); they are excluded.
  }
  return literal(parts.join(separator ?? " "), namedNode(XSD_STRING));
}

function integerLiteral(value: number | bigint): rdfjs.Literal {
  return literal(String(value), namedNode(XSD_INTEGER));
}

function numericLiteral(
  value: number,
  datatype: string,
): rdfjs.Literal {
  const text = datatype === XSD_DOUBLE || datatype === XSD_FLOAT
    ? canonicalDouble(value)
    : formatNumber(value, datatype);
  return literal(text, namedNode(datatype));
}

/**
 * WILDCARD_MARKER stands in for COUNT(*) arguments; only count uses it.
 */
const WILDCARD_MARKER = { wildcard: true } as unknown as rdfjs.Term;

/**
 * isAggregateWildcard detects the COUNT(*) form, which sparqljs represents
 * as an empty object (a Wildcard) rather than an expression.
 */
function isAggregateWildcard(
  expression: Expression | Wildcard,
): boolean {
  // sparqljs's Wildcard is an object with no own properties (its termType
  // lives on the prototype), so own-key emptiness is the reliable test.
  return (
    typeof expression === "object" &&
    expression !== null &&
    Object.keys(expression).length === 0
  );
}

/**
 * solutionKey renders a binding as a deterministic string for DISTINCT *
 * counting.
 */
function solutionKey(solution: TermBinding): string {
  return Object.keys(solution)
    .sort()
    .map((name) => `${name}=${termKey(solution[name])}`)
    .join("|");
}

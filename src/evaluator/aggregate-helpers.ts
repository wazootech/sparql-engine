import type * as rdfjs from "@rdfjs/types";
import {
  compareRdfTerms,
  DataFactory,
  termKey,
  XSD_STRING,
} from "@/term/mod.ts";
import type { Expression, Wildcard } from "@/parser/sparql-parser.ts";
import type { TermBinding } from "@/evaluator/join.ts";

const { literal, namedNode } = DataFactory;

export function minMaxAggregate(
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

export function groupConcat(
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

/**
 * WILDCARD_MARKER stands in for COUNT(*) arguments; only count uses it.
 */
export const WILDCARD_MARKER = { wildcard: true } as unknown as rdfjs.Term;

/**
 * isAggregateWildcard detects the COUNT(*) form, which sparqljs represents
 * as an empty object (a Wildcard) rather than an expression.
 */
export function isAggregateWildcard(
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
export function solutionKey(solution: TermBinding): string {
  return Object.keys(solution)
    .sort()
    .map((name) => `${name}=${termKey(solution[name])}`)
    .join("|");
}

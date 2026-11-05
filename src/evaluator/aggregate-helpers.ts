import type { RdfTerm } from "@/parser/rdf-terms.ts";
import {
  compareRdfTerms,
  DataFactory,
  termKey,
  XSD_STRING,
} from "@/term/mod.ts";
import type { AggregateExpression } from "@/parser/sparql-parser.ts";
import type { TermBinding } from "@/evaluator/join.ts";

const { literal, namedNode } = DataFactory;

export function minMaxAggregate(
  aggregation: "min" | "max",
  defined: RdfTerm[],
): RdfTerm | undefined {
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
  defined: RdfTerm[],
): RdfTerm {
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
export const WILDCARD_MARKER: RdfTerm = DataFactory.namedNode(
  "urn:wazoo:aggregate-wildcard",
);

/**
 * isAggregateWildcard detects the COUNT(*) form, which sparqljs represents
 * as an empty object (a Wildcard) rather than an expression.
 */
export function isAggregateWildcard(
  aggregate: AggregateExpression,
): boolean {
  return aggregate.wildcard === true;
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

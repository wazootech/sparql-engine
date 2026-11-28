/**
 * update-template.ts reads the quad templates of SPARQL 1.1 Update operations.
 */

import type { RdfTerm } from "@/parser/rdf-terms.ts";
import type {
  Pattern,
  Term as SparqlTerm,
  Triple,
} from "@/parser/sparql-parser.ts";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import { sparqlTermToRdfTerm } from "@/term/mod.ts";

/** templateTriples lists the triples of a BGP or named-graph template. */
export function templateTriples(pattern: Pattern): Triple[] {
  return (
    (pattern as unknown as { triples?: Triple[] }).triples ??
    (
      pattern as unknown as { patterns?: { triples?: Triple[] }[] }
    ).patterns?.flatMap((inner) => inner.triples ?? []) ??
    []
  );
}

/**
 * templateGraph resolves a template's graph name against one solution. A
 * variable that is unbound, or bound to a term that cannot name a graph, gives
 * null: the template's triples are left out for that solution.
 */
export function templateGraph(
  name: SparqlTerm,
  binding: TermBinding,
): RdfTerm | null {
  if (name.termType !== "Variable") {
    return sparqlTermToRdfTerm(name);
  }
  const bound = binding[name.value];
  if (bound === undefined) {
    return null;
  }
  return bound.termType === "NamedNode" || bound.termType === "BlankNode"
    ? bound
    : null;
}

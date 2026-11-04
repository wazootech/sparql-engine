/**
 * quad-terms builds the record quad terms for the SPARQL AST: the quad shape
 * (with the SPARQL 1.2 markers), component equality and the default-graph
 * quad constructor, over the plain-record terms in `term-values.ts`.
 */
import type { RdfBaseQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import { termKey } from "@/term/identity.ts";
import { defaultGraphTerm } from "@/parser/term-values.ts";

/** QuadTermValue is a quad term that may carry the SPARQL 1.2 markers. */
export interface QuadTermValue extends RdfBaseQuad {
  tripleTerm?: boolean;
  reifier?: RdfTerm;
}

/** quadComponentsEqual compares quad components to another term. */
export function quadComponentsEqual(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
  graph: RdfTerm,
  other: RdfTerm | null | undefined,
): boolean {
  if (other === null || other === undefined || other.termType !== "Quad") {
    return false;
  }
  const otherQuad = other as RdfBaseQuad;
  return termKey(subject) === termKey(otherQuad.subject) &&
    termKey(predicate) === termKey(otherQuad.predicate) &&
    termKey(object) === termKey(otherQuad.object) &&
    termKey(graph) === termKey(otherQuad.graph);
}

/** quadTerm builds a quad in the default graph. */
export function quadTerm(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
): QuadTermValue {
  const graph = defaultGraphTerm();
  return {
    termType: "Quad",
    value: "",
    subject,
    predicate,
    object,
    graph,
    // A capturing arrow, not an object-literal method: the native compiler
    // rejects `this` inside object-literal methods (SC1090), and a free
    // function's `this.subject` on the recursive term union infers as
    // `unknown` (SC1100). Closing over the components avoids both.
    equals: (other) =>
      quadComponentsEqual(subject, predicate, object, graph, other),
  };
}

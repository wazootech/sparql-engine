import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

/* ------------------------------------------------------------------ */
/* Synchronous path evaluation over a pre-materialized quad array     */
/* (the EXISTS hooks' drained store snapshot).                        */
/* ------------------------------------------------------------------ */

/**
 * matchQuadsSync filters a pre-materialized quad array (already scoped to a
 * single graph) by a triple pattern — the synchronous counterpart to
 * matchQuads, used by the EXISTS hooks which operate on the drained snapshot
 * instead of issuing stream matches.
 */
export function matchQuadsSync(
  candidates: RdfQuad[],
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
): RdfQuad[] {
  return candidates.filter((quad) =>
    (s === null || sameRdfTerm(quad.subject, s)) &&
    (p === null || sameRdfTerm(quad.predicate, p)) &&
    (o === null || sameRdfTerm(quad.object, o))
  );
}

/**
 * graphNodesSync returns every term appearing as a subject or object of any
 * candidate quad — the node set the reflexive path forms (? and *) are
 * defined over, restricted to the EXISTS snapshot's graph scope.
 */
export function graphNodesSync(candidates: RdfQuad[]): RdfTerm[] {
  const nodes = new Map<string, RdfTerm>();
  for (const quad of candidates) {
    nodes.set(termKey(quad.subject), quad.subject);
    nodes.set(termKey(quad.object), quad.object);
  }
  return [...nodes.values()];
}

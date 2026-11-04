import type * as rdfjs from "@rdfjs/types";
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
  candidates: rdfjs.Quad[],
  s: rdfjs.Term | null,
  p: rdfjs.Term | null,
  o: rdfjs.Term | null,
): rdfjs.Quad[] {
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
export function graphNodesSync(candidates: rdfjs.Quad[]): rdfjs.Term[] {
  const nodes = new Map<string, rdfjs.Term>();
  for (const quad of candidates) {
    nodes.set(termKey(quad.subject), quad.subject);
    nodes.set(termKey(quad.object), quad.object);
  }
  return [...nodes.values()];
}

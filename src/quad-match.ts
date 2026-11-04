import type * as rdfjs from "@rdfjs/types";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";

/**
 * storeVersion returns the store's mutation version when the store tracks
 * one (MemoryStore does), or null when changes cannot be detected — callers
 * that snapshot the store (the EXISTS synchronous index) must then rebuild
 * the snapshot per query.
 */
export function storeVersion(
  store: rdfjs.Source<rdfjs.Quad>,
): number | null {
  const version = (store as { version?: unknown }).version;
  return typeof version === "number" ? version : null;
}

/**
 * matchQuads collects all quads matching the given pattern from an RDF/JS
 * store, resolving the store's match stream into an array.
 */
export function matchQuads(
  store: rdfjs.Source<rdfjs.Quad>,
  s: rdfjs.Term | null,
  p: rdfjs.Term | null,
  o: rdfjs.Term | null,
  g: rdfjs.Term | null = null,
): Promise<rdfjs.Quad[]> {
  return new Promise<rdfjs.Quad[]>((resolve, reject) => {
    const quads: rdfjs.Quad[] = [];
    const stream = store.match(s, p, o, g);
    stream.on("data", (q: rdfjs.Quad) => quads.push(q));
    stream.on("end", () => resolve(quads));
    stream.on("error", reject);
  });
}

/**
 * isSimplePredicate narrows a predicate to a simple (term) predicate,
 * excluding property-path predicates.
 */
function isSimplePredicate(predicate: unknown): predicate is SparqlTerm {
  return (
    typeof predicate === "object" && predicate !== null &&
    "termType" in predicate
  );
}

/**
 * simplePredicate returns the predicate of a triple pattern or template,
 * rejecting property-path predicates that the engine does not support.
 */
export function simplePredicate(predicate: unknown): SparqlTerm {
  if (!isSimplePredicate(predicate)) {
    throw new Error(
      "Unsupported property path predicate: only simple predicates are supported",
    );
  }
  return predicate;
}

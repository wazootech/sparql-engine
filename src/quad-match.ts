import type { RdfQuad, RdfSource, RdfTerm } from "@/parser/rdf-terms.ts";
import type { TriplePredicate } from "@/parser/sparql-parser.ts";
import { GraphScopedStore } from "@/graph-scoped-store.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { matchQuadsViaStream } from "@/quad-store-stream.ts";
import { resolveGraphScope } from "@/graph-scoped-store.ts";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";

/**
 * storeVersion returns the store's mutation version when the store tracks
 * one (MemoryStore does), or null when changes cannot be detected — callers
 * that snapshot the store (the EXISTS synchronous index) must then rebuild
 * the snapshot per query.
 */
export function storeVersion(
  store: RdfSource<RdfQuad>,
): number | null {
  const version = (store as { version?: unknown }).version;
  return typeof version === "number" ? version : null;
}

/**
 * matchQuads collects all quads matching the given pattern from an RDF/JS
 * store, resolving the store's match stream into an array.
 */
export function matchQuads(
  store: RdfSource<RdfQuad>,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null = null,
): Promise<RdfQuad[]> {
  const graphTerm = resolveMatchGraph(store, g);
  const quads = memoryQuads(store, s, p, o, graphTerm);
  if (quads !== null) {
    return Promise.resolve(quads);
  }
  return matchQuadsViaStream(store, s, p, o, graphTerm);
}

/**
 * isSimplePredicate narrows a predicate to a simple (term) predicate,
 * excluding property-path predicates.
 */
function isSimplePredicate(
  predicate: TriplePredicate,
): predicate is SparqlTerm {
  return (
    typeof predicate === "object" && predicate !== null &&
    "termType" in predicate
  );
}

/**
 * simplePredicate returns the predicate of a triple pattern or template,
 * rejecting property-path predicates that the engine does not support.
 */
export function simplePredicate(predicate: TriplePredicate): SparqlTerm {
  if (!isSimplePredicate(predicate)) {
    throw new Error(
      "Unsupported property path predicate: only simple predicates are supported",
    );
  }
  return predicate;
}

/**
 * memoryQuadsOf answers a pattern from a MemoryStore. The receiver is a
 * statically typed parameter, not a dynamically narrowed one: the native
 * compiler (scriptc) cannot convert typed arguments to a receiver it only
 * knows as a dynamic value (SC1101).
 */
function memoryQuadsOf(
  memory: MemoryStore,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null,
): RdfQuad[] {
  return memory.getQuads(s, p, o, g);
}

/**
 * memoryQuads answers the pattern from an indexed MemoryStore underneath any
 * number of graph scopes, or null when the store is not one (the caller then
 * falls back to the RDF/JS stream). It returns quads, never the store: the
 * native compiler (scriptc) cannot represent a program class instance in a
 * checked-dynamic slot or union (`MemoryStore | null`), so narrowing happens
 * in place and only the plain `RdfQuad[]` result crosses the boundary.
 */
function memoryQuads(
  source: RdfSource<RdfQuad>,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null,
): RdfQuad[] | null {
  if (source instanceof MemoryStore) {
    return memoryQuadsOf(source, s, p, o, g);
  }
  if (source instanceof GraphScopedStore) {
    return memoryQuads(source.sourceStore, s, p, o, g);
  }
  return null;
}

/** resolveMatchGraph picks the graph argument for store.match / getQuads. */
function resolveMatchGraph(
  store: RdfSource<RdfQuad>,
  g: RdfTerm | null,
): RdfTerm | null {
  if (g !== null) {
    return g;
  }
  if (store instanceof GraphScopedStore) {
    return resolveGraphScope(store);
  }
  return null;
}

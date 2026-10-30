import type * as rdfjs from "@rdfjs/types";
import { sameRdfTerm, termKey } from "@/term/mod.ts";
export { storeVersion } from "@/quad-match.ts";
export { matchQuads } from "@/quad-match.ts";
export { simplePredicate } from "@/quad-match.ts";
export { GraphScopedStore } from "@/graph-scoped-store.ts";
export { namedGraphs } from "@/graph-scoped-store.ts";
export { buildDatasetStore } from "@/graph-scoped-store.ts";

/**
 * QuadIndex maps each of the three quad positions to the candidate quads
 * carrying that term, enabling O(1) bucket probes per solution. It backs
 * both the BGP hash join and the batched DELETE scans, so both paths probe
 * with identical semantics.
 *
 * Prior art: probing a pre-built positional bucket index instead of
 * re-scanning is the RDF-store index pattern of RDF-3X and Hexastore
 * (every quad is mirrored into per-position indexes so any constrained
 * pattern scans only its bucket), and picking the smallest constrained
 * bucket to probe is System R access-path selection.
 * @see {@link https://doi.org/10.14778/1453856.1453927 Neumann & Weikum, "RDF-3X: A RISC-Style Engine for RDF," PVLDB 1(1), 2008, pp. 647–659}
 * @see {@link https://doi.org/10.14778/1453856.1453965 Weiss, Karras & Bernstein, "Hexastore: Sextuple Indexing for Semantic Web Data Management," PVLDB 1(1), 2008, pp. 1008–1019}
 * @see {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}
 */
export interface QuadIndex {
  bySubject: Map<string, rdfjs.Quad[]>;
  byPredicate: Map<string, rdfjs.Quad[]>;
  byObject: Map<string, rdfjs.Quad[]>;
}

/**
 * buildQuadIndex indexes candidate quads by each of their three positions,
 * keyed by termKey, for O(1) bucket probes per solution.
 */
export function buildQuadIndex(quads: rdfjs.Quad[]): QuadIndex {
  const bySubject = new Map<string, rdfjs.Quad[]>();
  const byPredicate = new Map<string, rdfjs.Quad[]>();
  const byObject = new Map<string, rdfjs.Quad[]>();
  for (const item of quads) {
    indexQuad(bySubject, termKey(item.subject), item);
    indexQuad(byPredicate, termKey(item.predicate), item);
    indexQuad(byObject, termKey(item.object), item);
  }
  return { bySubject, byPredicate, byObject };
}

/**
 * indexQuad appends a quad to the bucket for the given key.
 */
function indexQuad(
  index: Map<string, rdfjs.Quad[]>,
  key: string,
  item: rdfjs.Quad,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(item);
  } else {
    index.set(key, [item]);
  }
}

/**
 * probeQuadIndex narrows candidate quads to those matching the resolved
 * positions (null = unconstrained). It starts from the smallest bucket for a
 * constrained position and filters the rest positionally with sameRdfTerm,
 * so the result contains exactly the quads matching every constrained
 * position. When nothing is constrained, all candidates are returned.
 */
export function probeQuadIndex(
  index: QuadIndex,
  candidates: rdfjs.Quad[],
  subject: rdfjs.Term | null,
  predicate: rdfjs.Term | null,
  object: rdfjs.Term | null,
): rdfjs.Quad[] {
  const options: rdfjs.Quad[][] = [];
  if (subject !== null) {
    options.push(index.bySubject.get(termKey(subject)) ?? []);
  }
  if (predicate !== null) {
    options.push(index.byPredicate.get(termKey(predicate)) ?? []);
  }
  if (object !== null) {
    options.push(index.byObject.get(termKey(object)) ?? []);
  }
  if (options.length === 0) {
    return candidates;
  }
  options.sort((a, b) => a.length - b.length);
  const bucket = options[0];
  return bucket.filter((item) =>
    (subject === null || sameRdfTerm(item.subject, subject)) &&
    (predicate === null || sameRdfTerm(item.predicate, predicate)) &&
    (object === null || sameRdfTerm(item.object, object))
  );
}

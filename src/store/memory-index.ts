import type * as rdfjs from "@rdfjs/types";
import { termKey } from "@/term/mod.ts";

/**
 * quadKey renders a deterministic key for a stored quad over all four
 * positions. Unlike `termKey`, which treats a quad as an RDF 1.2 triple term
 * (identity without a graph), quad identity in a dataset includes the graph,
 * so two quads that differ only by graph must not collide.
 */
export function quadKey(quad: rdfjs.Quad): string {
  return [
    termKey(quad.subject),
    termKey(quad.predicate),
    termKey(quad.object),
    termKey(quad.graph),
  ].join("|");
}

/**
 * indexPosition appends a quad to the bucket for the given term key.
 */
export function indexPosition(
  index: Map<string, rdfjs.Quad[]>,
  key: string,
  quad: rdfjs.Quad,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(quad);
  } else {
    index.set(key, [quad]);
  }
}

/**
 * unindexPosition removes a quad from the bucket for the given term key,
 * dropping the key once its bucket empties. Buckets never hold a quad more
 * than once, and the removal matches structurally (quadKey) because callers
 * pass a freshly constructed quad rather than the stored instance.
 */
export function unindexPosition(
  index: Map<string, rdfjs.Quad[]>,
  key: string,
  quad: rdfjs.Quad,
): void {
  const bucket = index.get(key);
  if (bucket === undefined) {
    return;
  }
  const targetKey = quadKey(quad);
  const position = bucket.findIndex((item) => quadKey(item) === targetKey);
  if (position >= 0) {
    bucket.splice(position, 1);
    if (bucket.length === 0) {
      index.delete(key);
    }
  }
}

import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad } from "@/parser/rdf-terms.ts";
import type { Triple } from "@/parser/sparql-parser.ts";
import type { StoreStatisticsHook } from "@/planner/pattern-statistics.ts";

/** createPatternStatisticsHook binds estimateStats when the store exposes it. */
export function createPatternStatisticsHook(
  store: rdfjs.Source<RdfQuad>,
): StoreStatisticsHook["estimateStats"] {
  const candidate = (store as StoreStatisticsHook).estimateStats;
  if (typeof candidate !== "function") {
    return undefined;
  }
  const estimateStats = candidate;
  return (pattern: Triple) => estimateStats.call(store, pattern);
}

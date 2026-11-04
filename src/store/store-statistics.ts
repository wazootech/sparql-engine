// store-statistics.ts looks up the optional store statistics hook. Hook
// discovery is inherently dynamic (any RDF/JS source may expose it), so
// scriptc replaces this module with store-statistics.native.ts
// (cli/tsconfig.json), whose builds use the deterministic fallback.
import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad } from "@/parser/rdf-terms.ts";
import type { Triple } from "@/parser/sparql-parser.ts";
import type {
  PatternStats,
  StoreStatisticsHook,
} from "@/planner/pattern-statistics.ts";

/**
 * estimateStatsViaStore asks the store's optional statistics hook, calling it
 * with the store as receiver, or returns undefined when it has none.
 */
export function estimateStatsViaStore(
  store: rdfjs.Source<RdfQuad>,
  pattern: Triple,
): PatternStats | Promise<PatternStats | undefined> | undefined {
  const candidate = (store as StoreStatisticsHook).estimateStats;
  if (typeof candidate !== "function") {
    return undefined;
  }
  return candidate.call(store, pattern);
}

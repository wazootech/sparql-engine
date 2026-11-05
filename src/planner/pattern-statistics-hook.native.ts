import type { RdfQuad, RdfSource } from "@/parser/rdf-terms.ts";
import type { StoreStatisticsHook } from "@/planner/pattern-statistics.ts";

/** Native builds use fallback stats only (see cli/tsconfig.json path map). */
export function createPatternStatisticsHook(
  _store?: RdfSource<RdfQuad>,
): StoreStatisticsHook["estimateStats"] {
  return undefined;
}

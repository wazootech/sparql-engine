// store-statistics.native.ts is the scriptc mapping for store-statistics.ts
// (cli/tsconfig.json). Native builds have no dynamic store capabilities, so
// pattern planning uses the deterministic fallback statistics path.
import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad } from "@/parser/rdf-terms.ts";
import type { Triple } from "@/parser/sparql-parser.ts";

/**
 * estimateStatsViaStore always reports no hook in native builds, selecting
 * the deterministic fallback statistics path.
 */
export function estimateStatsViaStore(
  _store: rdfjs.Source<RdfQuad>,
  _pattern: Triple,
): undefined {
  return undefined;
}

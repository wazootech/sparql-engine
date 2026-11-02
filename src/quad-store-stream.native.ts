import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";

/**
 * Native builds never call this: matchQuads resolves through MemoryStore only.
 * scriptc maps `@/quad-store-stream.ts` here via cli/tsconfig.json.
 */
export function matchQuadsViaStream(
  _store: rdfjs.Source<RdfQuad>,
  _subject: RdfTerm | null,
  _predicate: RdfTerm | null,
  _object: RdfTerm | null,
  _graph: RdfTerm | null,
): Promise<RdfQuad[]> {
  throw new Error(
    "matchQuads requires a MemoryStore-backed source in native builds",
  );
}

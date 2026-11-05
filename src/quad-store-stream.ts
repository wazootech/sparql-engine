import type { RdfQuad, RdfSource, RdfTerm } from "@/parser/rdf-terms.ts";
import type { QuadEventSource } from "@/store/quad-event-source.ts";

/**
 * matchQuadsViaStream drains an RDF/JS store.match stream into an array. Deno
 * uses this for generic Source implementations; scriptc replaces this module
 * with quad-store-stream.native.ts (see cli/tsconfig.json).
 */
export function matchQuadsViaStream(
  store: RdfSource<RdfQuad>,
  subject: RdfTerm | null,
  predicate: RdfTerm | null,
  object: RdfTerm | null,
  graph: RdfTerm | null,
): Promise<RdfQuad[]> {
  return new Promise<RdfQuad[]>((resolve, reject) => {
    const quads: RdfQuad[] = [];
    const stream = store.match(
      subject,
      predicate,
      object,
      graph,
    ) as unknown as QuadEventSource;
    stream.on("data", (quad: RdfQuad) => quads.push(quad));
    stream.on("end", () => resolve(quads));
    stream.on("error", reject);
  });
}

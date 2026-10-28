import type * as rdfjs from "@rdfjs/types";

/**
 * QuadEventSource is the listener-registration surface of an RDF/JS quad
 * stream that the engine relies on. It is declared locally so event
 * subscription resolves to this structural type rather than to the type-only
 * `@rdfjs/types` package, which has no runtime implementation to compile.
 */
export interface QuadEventSource {
  on(event: "data", listener: (quad: rdfjs.Quad) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

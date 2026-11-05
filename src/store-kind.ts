import type { RdfQuad, RdfSource } from "@/parser/rdf-terms.ts";

/**
 * StoreKind names the built-in store implementations the engine specializes
 * for. Stores carry it as a readonly `kind` field so hot paths dispatch on a
 * plain string compare instead of a runtime `instanceof` check, which the
 * native compiler (scriptc) cannot type statically.
 */
export type StoreKind = "memory" | "graph-scoped";

/**
 * storeKindOf returns the StoreKind a source declares through its `kind`
 * field, or null for any other RDF/JS source (custom stores never claim a
 * built-in kind).
 */
export function storeKindOf(source: RdfSource<RdfQuad>): StoreKind | null {
  const kind = (source as { kind?: unknown }).kind;
  if (kind === "memory" || kind === "graph-scoped") {
    return kind;
  }
  return null;
}

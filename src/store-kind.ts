import type { RdfQuad, RdfSource } from "@/parser/rdf-terms.ts";
import type { GraphScopedStore } from "@/graph-scoped-store.ts";
import type { MemoryStore } from "@/store/memory-store.ts";

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

/**
 * asGraphScopedStore narrows a source that storeKindOf reports as
 * "graph-scoped" to the GraphScopedStore type. The kind field is the source
 * of truth (set only by GraphScopedStore's constructor), so the cast is
 * exact by contract and scriptc can see the declared type instead of
 * falling back to a dynamic class cast.
 */
export function asGraphScopedStore(
  source: RdfSource<RdfQuad>,
): GraphScopedStore {
  return source as GraphScopedStore;
}

/**
 * asMemoryStore narrows a source that storeKindOf reports as "memory" to
 * the MemoryStore type; same exactness contract as asGraphScopedStore.
 */
export function asMemoryStore(source: RdfSource<RdfQuad>): MemoryStore {
  return source as MemoryStore;
}

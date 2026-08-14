import { assertEquals, assertNotEquals } from "@std/assert";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { canonicalStoreQuads } from "./parity-harness.ts";

const { blankNode, namedNode, quad } = DataFactory;
const p = namedNode("http://example.org/p");
const q = namedNode("http://example.org/q");
const o = namedNode("http://example.org/o");

function storeWith(...quads: ReturnType<typeof quad>[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

Deno.test("canonicalStoreQuads - repeated blank node in one quad is fully substituted", () => {
  // The same blank node bound as subject and object renders the same
  // placeholder twice; every occurrence must get the canonical id.
  const a = storeWith(quad(blankNode("x"), p, blankNode("x")));
  const b = storeWith(quad(blankNode("y"), p, blankNode("y")));
  assertEquals(canonicalStoreQuads(a), canonicalStoreQuads(b));
});

Deno.test("canonicalStoreQuads - distinct nodes in one quad stay distinct", () => {
  const a = storeWith(quad(blankNode("x"), p, blankNode("x")));
  const b = storeWith(quad(blankNode("x"), p, blankNode("y")));
  assertNotEquals(canonicalStoreQuads(a), canonicalStoreQuads(b));
});

Deno.test("canonicalStoreQuads - isomorphic multi-quad stores with relabeled blanks agree", () => {
  const a = storeWith(
    quad(blankNode("x"), p, blankNode("x")),
    quad(blankNode("x"), q, o),
  );
  const b = storeWith(
    quad(blankNode("zz"), p, blankNode("zz")),
    quad(blankNode("zz"), q, o),
  );
  assertEquals(canonicalStoreQuads(a), canonicalStoreQuads(b));
});

Deno.test("canonicalStoreQuads - shared blank node across quads canonicalizes consistently", () => {
  const a = storeWith(
    quad(blankNode("x"), p, o),
    quad(blankNode("x"), q, blankNode("x")),
  );
  const b = storeWith(
    quad(blankNode("u"), p, o),
    quad(blankNode("u"), q, blankNode("u")),
  );
  assertEquals(canonicalStoreQuads(a), canonicalStoreQuads(b));
});

import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { canonicalizeRdfTerm, DataFactory } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { compareConstructRecords, dedupeRecords } from "./runner.ts";

/**
 * Issue #87 contract pins: the W3C CONSTRUCT gate compares the wazoo result
 * as-emitted (a conforming engine emits no duplicate quads — decision #29),
 * while the reference side is normalized to its graph content (Comunica's
 * stream may repeat a triple its graph would not). The first test is the
 * regression detector the multiset contract exists for: a future wazoo
 * change that starts emitting duplicate quads must fail the gate, not
 * silently pass.
 */

const { namedNode, quad } = DataFactory;
const ex = (local: string) => namedNode(`http://example.org/${local}`);
const q = (s: string, p: string, o: string): rdfjs.Quad =>
  quad(ex(s), ex(p), ex(o));

/** rec renders one quad as the canonical [s, p, o] record the gate compares. */
function rec(item: rdfjs.Quad): CanonicalTerm[] {
  return [
    canonicalizeRdfTerm(item.subject),
    canonicalizeRdfTerm(item.predicate),
    canonicalizeRdfTerm(item.object),
  ];
}

/** key is the canonical string key dedupeRecords pairs records with. */
function key(item: rdfjs.Quad): string {
  return JSON.stringify(rec(item));
}

Deno.test(
  "CONSTRUCT gate fails when wazoo emits a duplicate quad (issue #87 regression detector)",
  () => {
    const quad1 = q("s", "p", "o");
    // Wazoo emits the same quad twice; the reference holds it once.
    assertEquals(
      compareConstructRecords(
        [rec(quad1), rec(quad1)],
        [rec(quad1)],
        [key(quad1)],
      ),
      false,
    );
  },
);

Deno.test(
  "CONSTRUCT gate normalizes duplicate reference-stream quads",
  () => {
    const quad1 = q("s", "p", "o");
    // Wazoo emits once; Comunica's stream repeats the triple — the
    // reference side is normalized, so the graphs agree.
    assertEquals(
      compareConstructRecords(
        [rec(quad1)],
        [rec(quad1), rec(quad1)],
        [key(quad1), key(quad1)],
      ),
      true,
    );
  },
);

Deno.test("CONSTRUCT gate passes on agreeing results in any order", () => {
  const quad1 = q("s", "p", "o");
  const quad2 = q("s", "q", "o2");
  assertEquals(
    compareConstructRecords(
      [rec(quad1), rec(quad2)],
      [rec(quad2), rec(quad1)],
      [key(quad2), key(quad1)],
    ),
    true,
  );
});

Deno.test("CONSTRUCT gate fails on missing quads", () => {
  const quad1 = q("s", "p", "o");
  const quad2 = q("s", "q", "o2");
  assertEquals(
    compareConstructRecords(
      [rec(quad1)],
      [rec(quad1), rec(quad2)],
      [key(quad1), key(quad2)],
    ),
    false,
  );
});

Deno.test("dedupeRecords keeps first occurrence and preserves order", () => {
  const quad1 = q("s", "p", "o");
  const quad2 = q("s", "q", "o2");
  const records = [rec(quad1), rec(quad2), rec(quad1)];
  const keys = [key(quad1), key(quad2), key(quad1)];
  assertEquals(dedupeRecords(records, keys), [rec(quad1), rec(quad2)]);
});

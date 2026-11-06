import { assertEquals } from "@std/assert";
import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import { DataFactory } from "@/term/public.ts";
import { termKey } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

/**
 * referenceQuadKey is the pre-optimization dedup key (four termKey calls
 * joined with "|"), kept here as the oracle for differential tests.
 */
function referenceQuadKey(item: RdfQuad): string {
  return [item.subject, item.predicate, item.object, item.graph]
    .map(termKey).join("|");
}

/**
 * ReferenceStore mirrors the old MemoryStore semantics: a canonical map in
 * insertion order, with match answered by a linear scan.
 */
class ReferenceStore {
  public readonly quads = new Map<string, RdfQuad>();
  public add(item: RdfQuad): void {
    const key = referenceQuadKey(item);
    if (!this.quads.has(key)) this.quads.set(key, item);
  }
  public remove(item: RdfQuad): void {
    this.quads.delete(referenceQuadKey(item));
  }
  public match(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): string[] {
    const wanted = [subject, predicate, object, graph];
    return [...this.quads.values()].filter((item) =>
      [item.subject, item.predicate, item.object, item.graph].every(
        (term, index) =>
          wanted[index] == null || termKey(term) === termKey(wanted[index]),
      )
    ).map(referenceQuadKey);
  }
}

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const subjects: RdfTerm[] = [
  ex("a"),
  ex("a|b"),
  ex("a\\"),
  blankNode("b0"),
  quad(ex("x"), ex("p"), literal("q")),
];
const predicates: RdfTerm[] = [ex("p"), ex("q|r")];
const objects: RdfTerm[] = [
  ex("a"),
  literal("v"),
  literal("v", "en"),
  literal("v", "EN-us"),
  literal("v", ex("dt")),
  literal("1|2"),
  blankNode("b0"),
  quad(ex("x"), ex("p"), quad(ex("y"), ex("p"), literal("z"))),
];
const graphs: RdfTerm[] = [defaultGraph(), ex("g1"), ex("g1|"), blankNode("g")];

function corpus(): RdfQuad[] {
  const out: RdfQuad[] = [];
  for (const s of subjects) {
    for (const p of predicates) {
      for (const o of objects) {
        for (const g of graphs) {
          out.push(quad(s, p, o, g) as RdfQuad);
        }
      }
    }
  }
  return out;
}

function assertSame(store: MemoryStore, reference: ReferenceStore): void {
  assertEquals(store.size, reference.quads.size);
  assertEquals(
    store.getQuads().map(referenceQuadKey),
    [...reference.quads.keys()],
  );
  const probes: (RdfTerm | null)[][] = [
    [subjects[0], null, null, null],
    [subjects[1], null, null, null],
    [subjects[4], null, null, null],
    [null, predicates[1], null, null],
    [null, null, objects[2], null],
    [null, null, objects[7], null],
    [null, null, null, graphs[2]],
    [subjects[3], predicates[0], objects[6], graphs[3]],
    [null, null, ex("absent"), null],
  ];
  for (const [s, p, o, g] of probes) {
    assertEquals(
      store.getQuads(s, p, o, g).map(referenceQuadKey),
      reference.match(s, p, o, g),
    );
  }
}

Deno.test("MemoryStore - add, duplicate add, remove, re-add match the old key behavior", () => {
  const all = corpus();
  const store = new MemoryStore();
  const reference = new ReferenceStore();
  for (const item of all) {
    store.addQuad(item);
    reference.add(item);
  }
  // Duplicates built as fresh, structurally equal instances.
  for (const item of all.filter((_, index) => index % 7 === 0)) {
    const copy = quad(item.subject, item.predicate, item.object, item.graph);
    store.addQuad(copy);
    reference.add(copy);
  }
  assertSame(store, reference);
  // Remove with fresh instances, then re-add (moves to the end of the order).
  const removed = all.filter((_, index) => index % 3 === 0);
  for (const item of removed) {
    const copy = quad(item.subject, item.predicate, item.object, item.graph);
    store.removeQuad(copy);
    reference.remove(copy);
  }
  assertSame(store, reference);
  for (const item of removed.filter((_, index) => index % 2 === 0)) {
    store.addQuad(item);
    reference.add(item);
  }
  assertSame(store, reference);
  // Removing an absent quad is a no-op.
  store.removeQuad(quad(ex("none"), ex("p"), literal("none")));
  assertSame(store, reference);
});

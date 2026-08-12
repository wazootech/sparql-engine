import { assertEquals, assertThrows } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import {
  buildQuadIndex,
  matchQuads,
  probeQuadIndex,
  simplePredicate,
} from "@/quad-store.ts";

const { namedNode, literal, quad } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const ethan = ex("ethan");
const gregory = ex("gregory");
const sandra = ex("sandra");
const name = ex("name");
const age = ex("age");
const knows = ex("knows");

const quads: rdfjs.Quad[] = [
  quad(ethan, name, literal("Ethan")),
  quad(ethan, age, literal("28")),
  quad(ethan, knows, gregory),
  quad(gregory, name, literal("Gregory")),
  quad(gregory, knows, sandra),
  quad(sandra, age, literal("30")),
];

Deno.test("buildQuadIndex indexes every quad under all three positions", () => {
  const index = buildQuadIndex(quads);
  assertEquals(index.bySubject.get("uri:http://example.org/ethan")!.length, 3);
  assertEquals(index.byPredicate.get("uri:http://example.org/name")!.length, 2);
  assertEquals(index.byObject.get("uri:http://example.org/gregory")!.length, 1);
  assertEquals(
    index.bySubject.get("uri:http://example.org/gregory")!.length,
    2,
  );
});

Deno.test("probeQuadIndex returns candidates when nothing is constrained", () => {
  const index = buildQuadIndex(quads);
  assertEquals(probeQuadIndex(index, quads, null, null, null), quads);
});

Deno.test("probeQuadIndex narrows by a single constrained position", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ethan, null, null);
  assertEquals(matches.length, 3);
  for (const item of matches) {
    assertEquals(item.subject, ethan);
  }
});

Deno.test("probeQuadIndex intersects all constrained positions", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ethan, knows, null);
  assertEquals(matches.length, 1);
  assertEquals(matches[0].object, gregory);

  const none = probeQuadIndex(index, quads, ethan, age, gregory);
  assertEquals(none.length, 0);
});

Deno.test("probeQuadIndex is empty for terms outside the candidates", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ex("dave"), null, null);
  assertEquals(matches.length, 0);
});

Deno.test("probeQuadIndex compares RDF-star quads structurally", () => {
  const nested = quad(quad(ethan, name, literal("Ethan")), name, literal("t"));
  const starQuads = [nested];
  const index = buildQuadIndex(starQuads);
  const matches = probeQuadIndex(index, starQuads, null, null, literal("t"));
  assertEquals(matches.length, 1);
  assertEquals(matches[0], nested);
});

Deno.test("matchQuads resolves the store stream into an array", async () => {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  const all = await matchQuads(store, null, null, null);
  assertEquals(all.length, 6);
  const bySubject = await matchQuads(store, ethan, null, null);
  assertEquals(bySubject.length, 3);
  const byPredicateAndObject = await matchQuads(store, null, knows, gregory);
  assertEquals(byPredicateAndObject.length, 1);
});

Deno.test("simplePredicate accepts terms and rejects property paths", () => {
  assertEquals(simplePredicate(name), name);
  assertThrows(
    () => simplePredicate({ pathType: "/", items: [name] }),
    Error,
    "property path",
  );
});

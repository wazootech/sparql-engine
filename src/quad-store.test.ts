import assert from "node:assert/strict";
import { test } from "node:test";
import { thrown } from "../test/thrown.ts";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/public.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
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

test("buildQuadIndex indexes every quad under all three positions", () => {
  const index = buildQuadIndex(quads);
  assert.deepStrictEqual(
    index.bySubject.get("uri:http://example.org/ethan")!.length,
    3,
  );
  assert.deepStrictEqual(
    index.byPredicate.get("uri:http://example.org/name")!.length,
    2,
  );
  assert.deepStrictEqual(
    index.byObject.get("uri:http://example.org/gregory")!.length,
    1,
  );
  assert.deepStrictEqual(
    index.bySubject.get("uri:http://example.org/gregory")!.length,
    2,
  );
});

test("probeQuadIndex returns candidates when nothing is constrained", () => {
  const index = buildQuadIndex(quads);
  assert.deepStrictEqual(probeQuadIndex(index, quads, null, null, null), quads);
});

test("probeQuadIndex narrows by a single constrained position", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ethan, null, null);
  assert.deepStrictEqual(matches.length, 3);
  for (const item of matches) {
    assert.deepStrictEqual(item.subject, ethan);
  }
});

test("probeQuadIndex intersects all constrained positions", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ethan, knows, null);
  assert.deepStrictEqual(matches.length, 1);
  assert.deepStrictEqual(matches[0].object, gregory);

  const none = probeQuadIndex(index, quads, ethan, age, gregory);
  assert.deepStrictEqual(none.length, 0);
});

test("probeQuadIndex is empty for terms outside the candidates", () => {
  const index = buildQuadIndex(quads);
  const matches = probeQuadIndex(index, quads, ex("dave"), null, null);
  assert.deepStrictEqual(matches.length, 0);
});

test("probeQuadIndex compares RDF-star quads structurally", () => {
  const nested = quad(quad(ethan, name, literal("Ethan")), name, literal("t"));
  const starQuads = [nested];
  const index = buildQuadIndex(starQuads);
  const matches = probeQuadIndex(index, starQuads, null, null, literal("t"));
  assert.deepStrictEqual(matches.length, 1);
  assert.deepStrictEqual(matches[0], nested);
});

test("matchQuads with omitted graph returns every graph in the store", async () => {
  const store = new Store();
  const g = ex("g");
  store.addQuad(quad(ethan, name, literal("Ethan")));
  store.addQuad(quad(ethan, name, literal("Ethan in G"), g));
  const all = await matchQuads(store, null, null, null);
  assert.deepStrictEqual(all.length, 2);
});

test("matchQuads resolves the store stream into an array", async () => {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  const all = await matchQuads(store, null, null, null);
  assert.deepStrictEqual(all.length, 6);
  const bySubject = await matchQuads(store, ethan, null, null);
  assert.deepStrictEqual(bySubject.length, 3);
  const byPredicateAndObject = await matchQuads(store, null, knows, gregory);
  assert.deepStrictEqual(byPredicateAndObject.length, 1);
});

test("simplePredicate accepts terms and rejects property paths", () => {
  assert.deepStrictEqual(simplePredicate(name), name);
  thrown(
    () => simplePredicate({ type: "path", pathType: "/", items: [name] }),
    Error,
    "property path",
  );
});

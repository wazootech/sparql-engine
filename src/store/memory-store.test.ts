import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore, MemoryStream } from "@/store/memory-store.ts";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
const alice = ex("alice");
const name = ex("name");
const knows = ex("knows");
const graphA = ex("g/a");
const graphB = ex("g/b");

function collect(
  stream: rdfjs.Stream<rdfjs.Quad>,
): Promise<rdfjs.Quad[]> {
  return new Promise((resolve, reject) => {
    const out: rdfjs.Quad[] = [];
    stream.on("data", (q: rdfjs.Quad) => out.push(q));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
}

Deno.test("MemoryStore - quads differing only by graph do not collide", () => {
  const store = new MemoryStore();
  const q1 = quad(alice, name, literal("A"), graphA);
  const q2 = quad(alice, name, literal("A"), graphB);
  const q3 = quad(alice, name, literal("A"), defaultGraph());

  store.addQuad(q1);
  store.addQuad(q2);
  store.addQuad(q3);

  assertEquals(store.size, 3);
  assertEquals(store.countQuads(), 3);

  // Same s/p/o across three different graphs: each match is exact.
  assertEquals(store.countQuads(null, null, null, graphA), 1);
  assertEquals(store.countQuads(null, null, null, graphB), 1);
  assertEquals(store.countQuads(null, null, null, defaultGraph()), 1);

  // Removing the default-graph quad leaves the named-graph quads intact.
  store.removeQuad(q3);
  assertEquals(store.size, 2);
  assertEquals(store.countQuads(null, null, null, graphA), 1);
  assertEquals(store.countQuads(null, null, null, graphB), 1);
});

Deno.test("MemoryStore - 4-argument addQuad matches the quad form", () => {
  const store = new MemoryStore();
  store.addQuad(alice, knows, ex("bob"), graphA);
  store.addQuad(alice, knows, ex("bob"), graphB);
  store.addQuad(alice, knows, ex("bob"));
  assertEquals(store.size, 3);
  assertEquals(
    store.countQuads(alice, knows, ex("bob"), graphA),
    1,
  );
  assertEquals(
    store.countQuads(alice, knows, ex("bob"), graphB),
    1,
  );
  // No graph filter spans all graphs; an explicit default graph is exact.
  assertEquals(store.countQuads(alice, knows, ex("bob")), 3);
  assertEquals(
    store.countQuads(alice, knows, ex("bob"), defaultGraph()),
    1,
  );
});

Deno.test("MemoryStore - countQuads filters per position", () => {
  const store = new MemoryStore();
  store.addQuad(quad(alice, name, literal("Alice")));
  store.addQuad(quad(alice, knows, ex("bob")));
  store.addQuad(quad(ex("bob"), name, literal("Bob")));

  assertEquals(store.countQuads(), 3);
  assertEquals(store.countQuads(alice), 2);
  assertEquals(store.countQuads(alice, name), 1);
  assertEquals(store.countQuads(null, name), 2);
  assertEquals(store.countQuads(null, null, literal("Bob")), 1);
  assertEquals(store.countQuads(ex("nobody")), 0);
});

Deno.test("MemoryStore - match() returns only matching quads in all graphs", async () => {
  const store = new MemoryStore();
  store.addQuad(quad(alice, name, literal("Alice"), graphA));
  store.addQuad(quad(alice, name, literal("Alice"), graphB));
  store.addQuad(quad(ex("bob"), name, literal("Bob")));

  // Predicate-scoped match spans all graphs.
  const allName = await collect(store.match(null, name));
  assertEquals(allName.length, 3);

  const all = await collect(store.match(alice, name));
  assertEquals(all.length, 2);

  // Graph-scoped match is exact even when s/p/o are identical elsewhere.
  const a = await collect(store.match(null, null, null, graphA));
  assertEquals(a.length, 1);
  assertEquals(a[0].graph.equals(graphA), true);

  // An explicit default-graph match only matches default-graph quads.
  const dg = await collect(store.match(null, null, null, defaultGraph()));
  assertEquals(dg.length, 1);
});

Deno.test("MemoryStore - removeMatches removes and streams the removed quads", async () => {
  const store = new MemoryStore();
  store.addQuad(quad(alice, name, literal("Alice"), graphA));
  store.addQuad(quad(alice, name, literal("Alice"), graphB));

  const removed = await collect(store.removeMatches(null, null, null, graphA));
  assertEquals(removed.length, 1);
  assertEquals(store.size, 1);
  assertEquals(store.countQuads(null, null, null, graphA), 0);
  assertEquals(store.countQuads(null, null, null, graphB), 1);
});

Deno.test("MemoryStore - deleteGraph removes exactly one graph", () => {
  const store = new MemoryStore();
  store.addQuad(quad(alice, name, literal("Alice"), graphA));
  store.addQuad(quad(alice, name, literal("Alice"), graphB));
  store.deleteGraph(graphA.value);
  assertEquals(store.size, 1);
  assertEquals(store.countQuads(null, null, null, graphA), 0);
  assertEquals(store.countQuads(null, null, null, graphB), 1);
});

Deno.test("MemoryStream - flow mode drains via data listeners", async () => {
  const quads = [
    quad(alice, name, literal("A")),
    quad(alice, name, literal("B")),
  ];
  const stream: rdfjs.Stream<rdfjs.Quad> = new MemoryStream(quads);
  const out: rdfjs.Quad[] = [];
  const ended = new Promise<void>((resolve) => {
    stream.on("data", (q: rdfjs.Quad) => out.push(q));
    stream.on("end", () => resolve());
  });
  await ended;
  assertEquals(out.length, 2);
  assertEquals(out[0].object.value, "A");
  assertEquals(out[1].object.value, "B");
});

Deno.test("MemoryStream - pull mode reads quads one at a time", () => {
  const quads = [
    quad(alice, name, literal("A")),
    quad(alice, name, literal("B")),
  ];
  const stream: rdfjs.Stream<rdfjs.Quad> = new MemoryStream(quads);
  assertEquals(stream.read()!.object.value, "A");
  assertEquals(stream.read()!.object.value, "B");
  assertEquals(stream.read(), null);
});

Deno.test("MemoryStream - readable event fires until exhausted", async () => {
  const quads = [
    quad(alice, name, literal("A")),
    quad(alice, name, literal("B")),
  ];
  const stream: rdfjs.Stream<rdfjs.Quad> = new MemoryStream(quads);
  const seen: string[] = [];
  const ended = new Promise<void>((resolve) => {
    stream.on("readable", () => {
      let q: rdfjs.Quad | null;
      while ((q = stream.read()) !== null) {
        seen.push(q.object.value);
      }
    });
    stream.on("end", () => resolve());
  });
  await ended;
  assertEquals(seen, ["A", "B"]);
});

Deno.test("MemoryStream - end-only listeners complete without consumption", async () => {
  // Comunica's store operations (e.g. deleteGraphs) await only `end`.
  const stream = new MemoryStream([quad(alice, name, literal("A"))]);
  const ended = new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
  });
  await ended;
  assertEquals(stream.listenerCount("data"), 0);
});

Deno.test("MemoryStream - end only fires after consumption when a consumer is attached", async () => {
  const quads = [
    quad(alice, name, literal("A")),
    quad(alice, name, literal("B")),
  ];
  const stream: rdfjs.Stream<rdfjs.Quad> = new MemoryStream(quads);
  let ended = false;
  const seen: string[] = [];
  stream.on("data", (q: rdfjs.Quad) => seen.push(q.object.value));
  stream.on("end", () => {
    ended = true;
  });
  // Synchronously after attaching a consumer, nothing has drained yet.
  assertEquals(ended, false);
  assertEquals(seen.length, 0);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(seen, ["A", "B"]);
  assertEquals(ended, true);
});

Deno.test("MemoryStream - iterator yields the quads", () => {
  const quads = [
    quad(alice, name, literal("A")),
    quad(alice, name, literal("B")),
  ];
  const stream = new MemoryStream(quads);
  const out = [...stream];
  assertEquals(out.length, 2);
  assertEquals(out[0].object.value, "A");
  assertEquals(out[1].object.value, "B");
});

Deno.test("MemoryStream - once fires a single time", async () => {
  const stream = new MemoryStream([quad(alice, name, literal("A"))]);
  let count = 0;
  stream.once("end", () => count++);
  await new Promise((r) => setTimeout(r, 0));
  // Re-emitting end is a no-op because the stream is already ended.
  assertEquals(count, 1);
});

Deno.test("MemoryStore - positional indexes stay exact across mutations", () => {
  const store = new MemoryStore();
  const s1 = ex("s1");
  const s2 = ex("s2");
  const p = ex("p");
  const o1 = ex("o1");
  const o2 = ex("o2");

  store.addQuad(quad(s1, p, o1));
  store.addQuad(quad(s2, p, o1));
  store.addQuad(quad(s1, p, o2));
  store.addQuad(quad(s1, p, o1, graphA));

  // Every constrained combination resolves through the smallest bucket.
  assertEquals(store.countQuads(s1), 3);
  assertEquals(store.countQuads(null, p), 4);
  assertEquals(store.countQuads(null, null, o1), 3);
  assertEquals(store.countQuads(s1, p, o1, graphA), 1);
  assertEquals(store.countQuads(s2, p, o1), 1);
  assertEquals(store.countQuads(s1, p, o2), 1);
  assertEquals(store.countQuads(s1, null, o1, graphA), 1);
  assertEquals(store.countQuads(null, null, null, defaultGraph()), 3);

  // Re-adding an existing quad must not duplicate any bucket entry.
  store.addQuad(quad(s1, p, o1));
  assertEquals(store.countQuads(s1), 3);
  assertEquals(store.countQuads(s1, p, o1), 2);
  assertEquals(store.size, 4);

  // Removing one quad unindexes it from every bucket; the rest survive.
  store.removeQuad(quad(s1, p, o1));
  assertEquals(store.countQuads(s1), 2);
  assertEquals(store.countQuads(null, null, o1), 2);
  assertEquals(store.countQuads(s1, p, o1), 1); // the named-graph copy
  assertEquals(store.countQuads(s1, p, o1, graphA), 1);

  // deleteGraph removes the whole graph bucket, leaving the default graph.
  store.deleteGraph(graphA);
  assertEquals(store.size, 2);
  assertEquals(store.countQuads(null, null, null, graphA), 0);
  assertEquals(store.countQuads(s1, p, o1), 0);
  assertEquals(store.countQuads(s1), 1);
  assertEquals(store.countQuads(s2, p, o1), 1);
});

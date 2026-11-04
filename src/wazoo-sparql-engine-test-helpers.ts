import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { assertEquals } from "@std/assert";

const { blankNode, namedNode, literal, quad } = DataFactory;

export function aggregateEngine(): WazooSparqlEngine {
  const store = new Store();
  const num = (s: string, v: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode("http://example.org/p"),
        literal(v, namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      ),
    );
  num("a", "1");
  num("a", "2");
  num("a", "3");
  num("b", "2");
  num("b", "4");
  return new WazooSparqlEngine({ store });
}

export async function aggregateRows(engine: WazooSparqlEngine, query: string) {
  const result = await engine.execute({ query });
  assertEquals(result.kind, "select");
  if (result.kind !== "select") {
    return [];
  }
  return result.data.results.bindings.map((b) => {
    const rec: Record<string, string> = {};
    for (const key of Object.keys(b)) {
      const value = b[key];
      rec[key] = value.type === "literal"
        ? `${value.value}^^${value.datatype ?? "string"}`
        : (value as { value: string }).value;
    }
    return JSON.stringify(rec);
  });
}

export function pathEngine(): WazooSparqlEngine {
  const store = new Store();
  const edge = (s: string, p: string, o: string) =>
    store.addQuad(
      quad(
        namedNode(`http://example.org/${s}`),
        namedNode(`http://example.org/${p}`),
        namedNode(`http://example.org/${o}`),
      ),
    );
  // a -> b -> c, a -> d -> c (two routes), plus unrelated edges.
  edge("a", "p", "b");
  edge("b", "p", "c");
  edge("a", "p", "d");
  edge("d", "p", "c");
  edge("c", "q", "w");
  edge("z", "q", "w");
  edge("x", "p", "y");
  return new WazooSparqlEngine({ store });
}

export async function pathBindings(engine: WazooSparqlEngine, query: string) {
  const result = await engine.execute({ query });
  assertEquals(result.kind, "select");
  if (result.kind !== "select") {
    return [];
  }
  return result.data.results.bindings.map((b) =>
    `${b.x ? b.x.value : "?"}->${b.y ? b.y.value : "?"}`
  ).sort();
}

export const XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * bindValue runs a SELECT query against the engine and returns the first
 * binding's value for the given variable as the wire format.
 */
export async function bindValue(
  engine: WazooSparqlEngine,
  query: string,
  variable: string,
): Promise<
  { type: string; value: string; datatype?: string; lang?: string } | null
> {
  const result = await engine.execute({ query });
  if (result.kind !== "select") {
    throw new Error(`expected select, got ${result.kind}`);
  }
  const binding = result.data.results.bindings[0];
  const value = binding[variable];
  if (value === undefined) {
    return null;
  }
  const out: { type: string; value: string; datatype?: string; lang?: string } =
    {
      type: value.type,
      value: typeof value.value === "string"
        ? value.value
        : JSON.stringify(value.value),
    };
  if (value.type === "literal") {
    if (value.datatype !== undefined) {
      out.datatype = value.datatype;
    }
    if (value["xml:lang"] !== undefined) {
      out.lang = value["xml:lang"];
    }
  }
  return out;
}

export function emptyEngine(): WazooSparqlEngine {
  return new WazooSparqlEngine({ store: new Store() });
}

/** Builds a store with reified triples: :s :p :o reified by :iri with an
 * annotation, and :s :p :o2 reified by a fresh blank node with an annotation. */
export function reifiedStore(): Store {
  const store = new Store();
  const s = namedNode("http://example.com/ns#s");
  const p = namedNode("http://example.com/ns#p");
  const o = namedNode("http://example.com/ns#o");
  const o2 = namedNode("http://example.com/ns#o2");
  const iri = namedNode("http://example.com/ns#iri");
  const r = namedNode("http://example.com/ns#r");
  const reifies = namedNode(
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  store.addQuad(quad(s, p, o));
  store.addQuad(quad(iri, reifies, quad(s, p, o)));
  store.addQuad(quad(iri, r, namedNode("http://example.com/ns#Z1")));
  store.addQuad(quad(s, p, o2));
  store.addQuad(quad(blankNode("r2"), reifies, quad(s, p, o2)));
  store.addQuad(
    quad(blankNode("r2"), r, namedNode("http://example.com/ns#Z2")),
  );
  return store;
}

/* ------------------------------------------------------------------ */
/* timeoutMs / signal enforcement (issue #122)                        */
/*                                                                    */
/* The end-of-request reject race (Comunica's shape) is exercised     */
/* against HangingStore, whose match stream never ends — evaluation   */
/* hangs until the request times out or aborts. The per-boundary      */
/* cancellation checks are exercised without any race (evaluator-     */
/* level call with a pre-aborted signal).                             */
/* ------------------------------------------------------------------ */

/**
 * hangingStore returns a store whose match stream never emits data and
 * never ends — matchQuads awaits the stream forever, so evaluation hangs
 * until the request's timeout or abort fires the end-of-request race.
 * Only the event surface matchQuads touches (on/read) exists at runtime;
 * the cast papers over the full EventEmitter/Store interfaces.
 */
export function hangingStore(): rdfjs.Store<rdfjs.Quad> {
  const stream = new EventTarget() as unknown as rdfjs.Stream<rdfjs.Quad>;
  (stream as unknown as { on(): void }).on = () => {};
  (stream as unknown as { read(): Promise<never> }).read = () =>
    new Promise<never>(() => {});
  return { match: () => stream } as unknown as rdfjs.Store<rdfjs.Quad>;
}

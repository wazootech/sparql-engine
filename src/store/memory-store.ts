import type * as rdfjs from "@rdfjs/types";
import { sameRdfTerm, termKey } from "@/term/mod.ts";
import { DataFactory, NamedNodeImpl } from "@/term/data-factory.ts";

type Listener = (...args: unknown[]) => void;

/**
 * quadKey renders a deterministic key for a stored quad over all four
 * positions. Unlike `termKey`, which treats a quad as an RDF 1.2 triple term
 * (identity without a graph), quad identity in a dataset includes the graph,
 * so two quads that differ only by graph must not collide.
 */
function quadKey(quad: rdfjs.Quad): string {
  return [
    termKey(quad.subject),
    termKey(quad.predicate),
    termKey(quad.object),
    termKey(quad.graph),
  ].join("|");
}

/**
 * MemoryStream is a minimal, zero-dependency RDF/JS Stream that replays a
 * fixed set of quads with Node Readable-compatible semantics:
 *
 * - attaching a `data` listener switches to flow mode and drains the quads,
 * - attaching a `readable` listener (or calling `read()`) enables pull mode,
 * - attaching only `end`/`error` listeners (a bare completion signal, as
 *   `promisifyEventEmitter` does for store operations) ends the stream once
 *   nothing else is consuming it,
 * - `end` is only emitted after every quad has been consumed.
 *
 * It implements the full EventEmitter surface required by the `rdfjs.Stream`
 * interface without depending on Node's `events` module, keeping the engine
 * runtime dependency-free and browser-friendly.
 */
export class MemoryStream implements rdfjs.Stream<rdfjs.Quad> {
  private _listeners = new Map<string | symbol, Listener[]>();
  private _maxListeners = 10;
  private _ended = false;
  private _flowing = false;
  private _readStarted = false;

  public constructor(private readonly quads: rdfjs.Quad[]) {}

  public read(): rdfjs.Quad | null {
    this._readStarted = true;
    const quad = this.quads.shift();
    if (quad === undefined) {
      this._end();
      return null;
    }
    return quad;
  }

  public [Symbol.iterator](): Iterator<rdfjs.Quad> {
    return this.quads[Symbol.iterator]();
  }

  public destroy(error?: Error): void {
    if (error) {
      this.emit("error", error);
    }
    this._ended = true;
    this.removeAllListeners();
  }

  public addListener(eventName: string | symbol, listener: Listener): this {
    return this.on(eventName, listener);
  }

  public on(eventName: string | symbol, listener: Listener): this {
    const list = this._listeners.get(eventName);
    if (list) {
      list.push(listener);
    } else {
      this._listeners.set(eventName, [listener]);
    }
    if (eventName === "data" && !this._ended && !this._flowing) {
      this._startFlowing();
    }
    if (eventName === "readable" && !this._ended && this.quads.length > 0) {
      queueMicrotask(() => {
        if (
          !this._ended && this.quads.length > 0 &&
          this.listenerCount("readable") > 0
        ) {
          this.emit("readable");
        }
      });
    }
    if (eventName === "end" && !this._ended) {
      queueMicrotask(() => {
        if (
          !this._ended && !this._flowing && !this._readStarted &&
          this.listenerCount("data") === 0 &&
          this.listenerCount("readable") === 0
        ) {
          this._end();
        }
      });
    }
    return this;
  }

  public once(eventName: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      this.removeListener(eventName, wrapper);
      listener(...args);
    };
    return this.on(eventName, wrapper);
  }

  public prependListener(eventName: string | symbol, listener: Listener): this {
    const list = this._listeners.get(eventName);
    if (list) {
      list.unshift(listener);
    } else {
      this._listeners.set(eventName, [listener]);
    }
    return this;
  }

  public prependOnceListener(
    eventName: string | symbol,
    listener: Listener,
  ): this {
    const wrapper: Listener = (...args) => {
      this.removeListener(eventName, wrapper);
      listener(...args);
    };
    return this.prependListener(eventName, wrapper);
  }

  public removeListener(eventName: string | symbol, listener: Listener): this {
    const list = this._listeners.get(eventName);
    if (list) {
      const index = list.indexOf(listener);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }
    return this;
  }

  public off(eventName: string | symbol, listener: Listener): this {
    return this.removeListener(eventName, listener);
  }

  public removeAllListeners(eventName?: string | symbol): this {
    if (eventName === undefined) {
      this._listeners.clear();
    } else {
      this._listeners.delete(eventName);
    }
    return this;
  }

  public setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  public getMaxListeners(): number {
    return this._maxListeners;
  }

  public listeners(eventName: string | symbol): Listener[] {
    return [...(this._listeners.get(eventName) ?? [])];
  }

  public rawListeners(eventName: string | symbol): Listener[] {
    return [...(this._listeners.get(eventName) ?? [])];
  }

  public emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const list = this._listeners.get(eventName);
    if (!list || list.length === 0) {
      return false;
    }
    for (const fn of [...list]) {
      fn.apply(this, args);
    }
    return true;
  }

  public listenerCount(eventName: string | symbol): number {
    return this._listeners.get(eventName)?.length ?? 0;
  }

  public eventNames(): Array<string | symbol> {
    return [...this._listeners.keys()];
  }

  private _startFlowing(): void {
    this._flowing = true;
    queueMicrotask(() => this._drain());
  }

  private _drain(): void {
    if (this._ended || !this._flowing) {
      return;
    }
    while (this.listenerCount("data") > 0) {
      const quad = this.quads.shift();
      if (quad === undefined) {
        break;
      }
      this.emit("data", quad);
    }
    if (this.quads.length === 0) {
      this._end();
    }
  }

  private _end(): void {
    if (this._ended) {
      return;
    }
    this._ended = true;
    this.emit("end");
  }
}

/**
 * MemoryStore is a minimal in-memory RDF/JS Store used to materialize FROM and
 * FROM NAMED datasets (and transient update materializations) inside the
 * engine. It replaces N3's Store with a zero-dependency equivalent.
 */
export class MemoryStore implements rdfjs.Store<rdfjs.Quad> {
  private quads: Map<string, rdfjs.Quad> = new Map();

  public constructor(initialQuads?: rdfjs.Quad[]) {
    if (initialQuads) {
      for (const q of initialQuads) {
        this.addQuad(q);
      }
    }
  }

  public addQuad(quad: rdfjs.Quad): this;
  public addQuad(
    subject: rdfjs.Term,
    predicate: rdfjs.Term,
    object: rdfjs.Term,
    graph?: rdfjs.Term,
  ): this;
  public addQuad(
    quadOrSubject: rdfjs.Quad | rdfjs.Term,
    predicate?: rdfjs.Term,
    object?: rdfjs.Term,
    graph?: rdfjs.Term,
  ): this {
    const quad = predicate !== undefined && object !== undefined
      ? DataFactory.quad(
        quadOrSubject as rdfjs.Term,
        predicate,
        object,
        graph,
      )
      : quadOrSubject as rdfjs.Quad;
    this.quads.set(quadKey(quad), quad);
    return this;
  }

  public removeQuad(quad: rdfjs.Quad): this {
    this.quads.delete(quadKey(quad));
    return this;
  }

  public remove(stream: rdfjs.Stream<rdfjs.Quad>): rdfjs.Stream<rdfjs.Quad> {
    stream.on("data", (q: rdfjs.Quad) => this.removeQuad(q));
    return stream;
  }

  public import(stream: rdfjs.Stream<rdfjs.Quad>): rdfjs.Stream<rdfjs.Quad> {
    stream.on("data", (q: rdfjs.Quad) => this.addQuad(q));
    return stream;
  }

  public getQuads(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): rdfjs.Quad[] {
    const matches: rdfjs.Quad[] = [];
    for (const quad of this.quads.values()) {
      if (subject != null && !sameRdfTerm(quad.subject, subject)) {
        continue;
      }
      if (predicate != null && !sameRdfTerm(quad.predicate, predicate)) {
        continue;
      }
      if (object != null && !sameRdfTerm(quad.object, object)) {
        continue;
      }
      if (graph != null && !sameRdfTerm(quad.graph, graph)) {
        continue;
      }
      matches.push(quad);
    }
    return matches;
  }

  public countQuads(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): number {
    return this.getQuads(subject, predicate, object, graph).length;
  }

  public removeMatches(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): MemoryStream {
    const matches = this.getQuads(subject, predicate, object, graph);
    for (const q of matches) {
      this.removeQuad(q);
    }
    return new MemoryStream(matches);
  }

  public deleteGraph(graph: rdfjs.Quad_Graph | string): MemoryStream {
    const graphTerm = typeof graph === "string"
      ? new NamedNodeImpl(graph)
      : graph;
    return this.removeMatches(null, null, null, graphTerm);
  }

  public match(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): MemoryStream {
    return new MemoryStream(this.getQuads(subject, predicate, object, graph));
  }

  public get size(): number {
    return this.quads.size;
  }
}

// quad-stream.ts is the Deno-only RDF/JS stream surface: MemoryStream, the
// data-listener binding the shared store uses, and the generic match stream.
// scriptc replaces this module with quad-stream.native.ts (cli/tsconfig.json);
// the native CLI answers every scan through MemoryStore.getQuads instead.
import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import type { QuadEventSource } from "@/store/quad-event-source.ts";

type Listener = (...args: unknown[]) => void;
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
export class MemoryStream implements rdfjs.Stream<RdfQuad> {
  private _listeners = new Map<string | symbol, Listener[]>();
  private _maxListeners = 10;
  private _ended = false;
  private _flowing = false;
  private _readStarted = false;

  public constructor(private readonly quads: RdfQuad[]) {}

  public read(): RdfQuad | null {
    this._readStarted = true;
    const quad = this.quads.shift();
    if (quad === undefined) {
      this._end();
      return null;
    }
    return quad;
  }

  public [Symbol.iterator](): Iterator<RdfQuad> {
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
 * subscribeQuadData registers a data listener on an RDF/JS quad stream. The
 * binding lives here so the shared store never casts a stream to the local
 * event-source surface.
 */
export function subscribeQuadData(
  stream: rdfjs.Stream<RdfQuad>,
  listener: (quad: RdfQuad) => void,
): void {
  (stream as unknown as QuadEventSource).on("data", listener);
}

/**
 * matchQuadStream starts a store scan and returns its RDF/JS quad stream.
 */
export function matchQuadStream(
  store: rdfjs.Source<RdfQuad>,
  subject?: RdfTerm | null,
  predicate?: RdfTerm | null,
  object?: RdfTerm | null,
  graph?: RdfTerm | null,
): rdfjs.Stream<RdfQuad> {
  return store.match(subject, predicate, object, graph);
}

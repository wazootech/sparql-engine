// quad-stream.native.ts is the scriptc mapping for quad-stream.ts (see
// cli/tsconfig.json). Native builds answer every scan through
// MemoryStore.getQuads, so no RDF/JS quad stream is ever constructed or
// drained; the surface stays available to the type checker and throws when a
// caller reaches it.
import type {
  RdfQuad,
  RdfSource,
  RdfStream,
  RdfTerm,
} from "@/parser/rdf-terms.ts";

type Listener = (...args: unknown[]) => void;

function unsupported(): never {
  throw new Error(
    "RDF/JS quad streams are not supported in native builds: scans answer through MemoryStore.getQuads",
  );
}

/**
 * MemoryStream is unavailable in native builds: every member throws because
 * the native CLI never materializes a quad stream.
 */
export class MemoryStream implements RdfStream<RdfQuad> {
  public constructor(_quads: RdfQuad[]) {
    unsupported();
  }

  public read(): RdfQuad | null {
    return unsupported();
  }

  public destroy(_error?: Error): void {
    unsupported();
  }

  public addListener(_eventName: string | symbol, _listener: Listener): this {
    return unsupported();
  }

  public on(_eventName: string | symbol, _listener: Listener): this {
    return unsupported();
  }

  public once(_eventName: string | symbol, _listener: Listener): this {
    return unsupported();
  }

  public prependListener(
    _eventName: string | symbol,
    _listener: Listener,
  ): this {
    return unsupported();
  }

  public prependOnceListener(
    _eventName: string | symbol,
    _listener: Listener,
  ): this {
    return unsupported();
  }

  public removeListener(
    _eventName: string | symbol,
    _listener: Listener,
  ): this {
    return unsupported();
  }

  public off(_eventName: string | symbol, _listener: Listener): this {
    return unsupported();
  }

  public removeAllListeners(_eventName?: string | symbol): this {
    return unsupported();
  }

  public setMaxListeners(_n: number): this {
    return unsupported();
  }

  public getMaxListeners(): number {
    return unsupported();
  }

  public listeners(_eventName: string | symbol): Listener[] {
    return unsupported();
  }

  public rawListeners(_eventName: string | symbol): Listener[] {
    return unsupported();
  }

  public emit(_eventName: string | symbol, ..._args: unknown[]): boolean {
    return unsupported();
  }

  public listenerCount(
    _eventName: string | symbol,
    _listener?: Listener,
  ): number {
    return unsupported();
  }

  public eventNames(): Array<string | symbol> {
    return unsupported();
  }
}

/**
 * subscribeQuadData is unavailable in native builds, where no store scan
 * exposes an RDF/JS stream.
 */
export function subscribeQuadData(
  _stream: RdfStream<RdfQuad>,
  _listener: (quad: RdfQuad) => void,
): void {
  unsupported();
}

/**
 * matchQuadStream is unavailable in native builds: matchQuads answers
 * MemoryStore scans directly through getQuads.
 */
export function matchQuadStream(
  _store: RdfSource<RdfQuad>,
  _subject?: RdfTerm | null,
  _predicate?: RdfTerm | null,
  _object?: RdfTerm | null,
  _graph?: RdfTerm | null,
): RdfStream<RdfQuad> {
  return unsupported();
}

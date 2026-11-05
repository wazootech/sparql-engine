import type {
  RdfQuad,
  RdfQuadGraph,
  RdfStore,
  RdfStream,
  RdfTerm,
} from "@/parser/rdf-terms.ts";
import { MemoryStream, subscribeQuadData } from "@/store/quad-stream.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";
import { DataFactory } from "@/term/data-factory.ts";

export { MemoryStream };

/**
 * quadKey renders a deterministic key for a stored quad over all four
 * positions. Unlike `termKey`, which treats a quad as an RDF 1.2 triple term
 * (identity without a graph), quad identity in a dataset includes the graph,
 * so two quads that differ only by graph must not collide.
 */
function quadKey(quad: RdfQuad): string {
  return [
    termKey(quad.subject),
    termKey(quad.predicate),
    termKey(quad.object),
    termKey(quad.graph),
  ].join("|");
}

/**
 * indexPosition appends a quad to the bucket for the given term key.
 */
function indexPosition(
  index: Map<string, RdfQuad[]>,
  key: string,
  quad: RdfQuad,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(quad);
  } else {
    index.set(key, [quad]);
  }
}

/**
 * unindexPosition removes a quad from the bucket for the given term key,
 * dropping the key once its bucket empties. Buckets never hold a quad more
 * than once, and the removal matches structurally (quadKey) because callers
 * pass a freshly constructed quad rather than the stored instance.
 */
function unindexPosition(
  index: Map<string, RdfQuad[]>,
  key: string,
  quad: RdfQuad,
): void {
  const bucket = index.get(key);
  if (bucket === undefined) {
    return;
  }
  const targetKey = quadKey(quad);
  const position = bucket.findIndex((item) => quadKey(item) === targetKey);
  if (position >= 0) {
    bucket.splice(position, 1);
    if (bucket.length === 0) {
      index.delete(key);
    }
  }
}

/**
 * MemoryStore is a minimal, zero-dependency in-memory RDF/JS Store used to
 * materialize FROM and FROM NAMED datasets (and transient update
 * materializations) inside the engine. Every quad is held once in a canonical
 * map keyed by all four positions and mirrored into four positional indexes
 * (subject / predicate / object / graph), so match scans only the smallest
 * constrained bucket instead of the whole store.
 *
 * Prior art: the mirror-into-per-position-indexes design (any pattern
 * resolves through one bucket rather than a full scan) is the RDF-store
 * index pattern of RDF-3X and Hexastore, and probing the smallest
 * constrained bucket is System R-style access-path selection.
 * @see {@link https://doi.org/10.14778/1453856.1453927 Neumann & Weikum, "RDF-3X: A RISC-Style Engine for RDF," PVLDB 1(1), 2008, pp. 647–659}
 * @see {@link https://doi.org/10.14778/1453856.1453965 Weiss, Karras & Bernstein, "Hexastore: Sextuple Indexing for Semantic Web Data Management," PVLDB 1(1), 2008, pp. 1008–1019}
 * @see {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}
 */
export class MemoryStore implements RdfStore<RdfQuad> {
  /** kind marks this store as the built-in in-memory store (see StoreKind). */
  public readonly kind = "memory" as const;

  private quads: Map<string, RdfQuad> = new Map();
  private bySubject: Map<string, RdfQuad[]> = new Map();
  private byPredicate: Map<string, RdfQuad[]> = new Map();
  private byObject: Map<string, RdfQuad[]> = new Map();
  private byGraph: Map<string, RdfQuad[]> = new Map();
  private _version = 0;

  /**
   * version increments on every mutation, letting caches that snapshot the
   * store (the EXISTS synchronous index) detect staleness and rebuild only
   * when the data actually changed.
   */
  public get version(): number {
    return this._version;
  }

  public constructor(initialQuads?: RdfQuad[]) {
    if (initialQuads) {
      for (const q of initialQuads) {
        this.addQuad(q);
      }
    }
  }

  public addQuad(quad: RdfQuad): this;
  public addQuad(
    subject: RdfTerm,
    predicate: RdfTerm,
    object: RdfTerm,
    graph?: RdfTerm,
  ): this;
  public addQuad(
    quadOrSubject: RdfQuad | RdfTerm,
    predicate?: RdfTerm,
    object?: RdfTerm,
    graph?: RdfTerm,
  ): this {
    const quad = predicate !== undefined && object !== undefined
      ? DataFactory.quad(
        quadOrSubject as RdfTerm,
        predicate,
        object,
        graph,
      )
      : quadOrSubject as RdfQuad;
    const key = quadKey(quad);
    // Re-adding an existing quad keeps the canonical map (and the indexes)
    // unchanged; only genuinely new quads are indexed.
    if (!this.quads.has(key)) {
      this.quads.set(key, quad);
      indexPosition(this.bySubject, termKey(quad.subject), quad);
      indexPosition(this.byPredicate, termKey(quad.predicate), quad);
      indexPosition(this.byObject, termKey(quad.object), quad);
      indexPosition(this.byGraph, termKey(quad.graph), quad);
    }
    this._version++;
    return this;
  }

  public removeQuad(quad: RdfQuad): this {
    const key = quadKey(quad);
    if (this.quads.delete(key)) {
      unindexPosition(this.bySubject, termKey(quad.subject), quad);
      unindexPosition(this.byPredicate, termKey(quad.predicate), quad);
      unindexPosition(this.byObject, termKey(quad.object), quad);
      unindexPosition(this.byGraph, termKey(quad.graph), quad);
    }
    this._version++;
    return this;
  }

  public remove(stream: RdfStream<RdfQuad>): RdfStream<RdfQuad> {
    subscribeQuadData(stream, (quad) => this.removeQuad(quad));
    return stream;
  }

  public import(stream: RdfStream<RdfQuad>): RdfStream<RdfQuad> {
    subscribeQuadData(stream, (quad) => this.addQuad(quad));
    return stream;
  }

  public getQuads(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): RdfQuad[] {
    // A constrained position with no indexed quads means nothing can match.
    if (
      (subject != null && !this.bySubject.has(termKey(subject))) ||
      (predicate != null && !this.byPredicate.has(termKey(predicate))) ||
      (object != null && !this.byObject.has(termKey(object))) ||
      (graph != null && !this.byGraph.has(termKey(graph)))
    ) {
      return [];
    }
    // Probe the smallest constrained bucket, then filter the rest positionally
    // (buckets are never empty: unindexPosition drops empty keys).
    const constrained: RdfQuad[][] = [];
    if (subject != null) {
      constrained.push(this.bySubject.get(termKey(subject))!);
    }
    if (predicate != null) {
      constrained.push(this.byPredicate.get(termKey(predicate))!);
    }
    if (object != null) {
      constrained.push(this.byObject.get(termKey(object))!);
    }
    if (graph != null) {
      constrained.push(this.byGraph.get(termKey(graph))!);
    }

    if (constrained.length === 0) {
      // No constraints: every quad matches, in insertion order.
      return [...this.quads.values()];
    }
    let bucket = constrained[0];
    for (const candidate of constrained) {
      if (candidate.length < bucket.length) {
        bucket = candidate;
      }
    }
    return bucket.filter((quad) =>
      (subject == null || sameRdfTerm(quad.subject, subject)) &&
      (predicate == null || sameRdfTerm(quad.predicate, predicate)) &&
      (object == null || sameRdfTerm(quad.object, object)) &&
      (graph == null || sameRdfTerm(quad.graph, graph))
    );
  }

  public countQuads(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): number {
    return this.getQuads(subject, predicate, object, graph).length;
  }

  public removeMatches(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): MemoryStream {
    const matches = this.getQuads(subject, predicate, object, graph);
    for (const q of matches) {
      this.removeQuad(q);
    }
    return new MemoryStream(matches);
  }

  public deleteGraph(graph: RdfQuadGraph | string): MemoryStream {
    const graphTerm = typeof graph === "string"
      ? DataFactory.namedNode(graph)
      : graph;
    return this.removeMatches(null, null, null, graphTerm);
  }

  public match(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): MemoryStream {
    return new MemoryStream(this.getQuads(subject, predicate, object, graph));
  }

  public get size(): number {
    return this.quads.size;
  }
}

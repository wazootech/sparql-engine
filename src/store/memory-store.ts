import type * as rdfjs from "@rdfjs/types";
import { DataFactory, NamedNodeImpl } from "@/term/data-factory.ts";
import { MemoryStream } from "@/store/memory-stream.ts";
import {
  indexPosition,
  quadKey,
  unindexPosition,
} from "@/store/memory-index.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";
export { MemoryStream } from "@/store/memory-stream.ts";

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
export class MemoryStore implements rdfjs.Store<rdfjs.Quad> {
  private quads: Map<string, rdfjs.Quad> = new Map();
  private bySubject: Map<string, rdfjs.Quad[]> = new Map();
  private byPredicate: Map<string, rdfjs.Quad[]> = new Map();
  private byObject: Map<string, rdfjs.Quad[]> = new Map();
  private byGraph: Map<string, rdfjs.Quad[]> = new Map();
  private _version = 0;

  /**
   * version increments on every mutation, letting caches that snapshot the
   * store (the EXISTS synchronous index) detect staleness and rebuild only
   * when the data actually changed.
   */
  public get version(): number {
    return this._version;
  }

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

  public removeQuad(quad: rdfjs.Quad): this {
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
    const constrained: rdfjs.Quad[][] = [];
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

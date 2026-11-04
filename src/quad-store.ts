import type * as rdfjs from "@rdfjs/types";
import type { RdfQuad, RdfQuadGraph, RdfTerm } from "@/parser/rdf-terms.ts";
import type {
  Term as SparqlTerm,
  Triple,
  TriplePredicate,
} from "@/parser/sparql-parser.ts";
import type { PatternStats } from "@/planner/pattern-statistics.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { matchQuadStream } from "@/store/quad-stream.ts";
import { estimateStatsViaStore } from "@/store/store-statistics.ts";
import { matchQuadsViaStream } from "@/quad-store-stream.ts";
import { DataFactory, defaultGraphInstance } from "@/term/data-factory.ts";
import { quadDedupKey } from "@/term/quad-narrow.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

/**
 * QuadIndex maps each of the three quad positions to the candidate quads
 * carrying that term, enabling O(1) bucket probes per solution. It backs
 * both the BGP hash join and the batched DELETE scans, so both paths probe
 * with identical semantics.
 *
 * Prior art: probing a pre-built positional bucket index instead of
 * re-scanning is the RDF-store index pattern of RDF-3X and Hexastore
 * (every quad is mirrored into per-position indexes so any constrained
 * pattern scans only its bucket), and picking the smallest constrained
 * bucket to probe is System R access-path selection.
 * @see {@link https://doi.org/10.14778/1453856.1453927 Neumann & Weikum, "RDF-3X: A RISC-Style Engine for RDF," PVLDB 1(1), 2008, pp. 647–659}
 * @see {@link https://doi.org/10.14778/1453856.1453965 Weiss, Karras & Bernstein, "Hexastore: Sextuple Indexing for Semantic Web Data Management," PVLDB 1(1), 2008, pp. 1008–1019}
 * @see {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}
 */
export interface QuadIndex {
  bySubject: Map<string, RdfQuad[]>;
  byPredicate: Map<string, RdfQuad[]>;
  byObject: Map<string, RdfQuad[]>;
}

/**
 * buildQuadIndex indexes candidate quads by each of their three positions,
 * keyed by termKey, for O(1) bucket probes per solution.
 */
export function buildQuadIndex(quads: RdfQuad[]): QuadIndex {
  const bySubject = new Map<string, RdfQuad[]>();
  const byPredicate = new Map<string, RdfQuad[]>();
  const byObject = new Map<string, RdfQuad[]>();
  for (const item of quads) {
    indexQuad(bySubject, termKey(item.subject), item);
    indexQuad(byPredicate, termKey(item.predicate), item);
    indexQuad(byObject, termKey(item.object), item);
  }
  return { bySubject, byPredicate, byObject };
}

/**
 * indexQuad appends a quad to the bucket for the given key.
 */
function indexQuad(
  index: Map<string, RdfQuad[]>,
  key: string,
  item: RdfQuad,
): void {
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(item);
  } else {
    index.set(key, [item]);
  }
}

/**
 * probeQuadIndex narrows candidate quads to those matching the resolved
 * positions (null = unconstrained). It starts from the smallest bucket for a
 * constrained position and filters the rest positionally with sameRdfTerm,
 * so the result contains exactly the quads matching every constrained
 * position. When nothing is constrained, all candidates are returned.
 */
export function probeQuadIndex(
  index: QuadIndex,
  candidates: RdfQuad[],
  subject: RdfTerm | null,
  predicate: RdfTerm | null,
  object: RdfTerm | null,
): RdfQuad[] {
  const options: RdfQuad[][] = [];
  if (subject !== null) {
    options.push(index.bySubject.get(termKey(subject)) ?? []);
  }
  if (predicate !== null) {
    options.push(index.byPredicate.get(termKey(predicate)) ?? []);
  }
  if (object !== null) {
    options.push(index.byObject.get(termKey(object)) ?? []);
  }
  if (options.length === 0) {
    return candidates;
  }
  options.sort((a, b) => a.length - b.length);
  const bucket = options[0];
  return bucket.filter((item) =>
    (subject === null || sameRdfTerm(item.subject, subject)) &&
    (predicate === null || sameRdfTerm(item.predicate, predicate)) &&
    (object === null || sameRdfTerm(item.object, object))
  );
}

/**
 * storeVersion returns the store's mutation version when the store tracks
 * one (MemoryStore does), or null when changes cannot be detected — callers
 * that snapshot the store (the EXISTS synchronous index) must then rebuild
 * the snapshot per query.
 */
export function storeVersion(
  store: rdfjs.Source<RdfQuad>,
): number | null {
  const version = (store as { version?: unknown }).version;
  return typeof version === "number" ? version : null;
}

/**
 * memoryQuadsOf answers a pattern from a MemoryStore. The receiver is a
 * statically typed parameter, not a dynamically narrowed one: the native
 * compiler (scriptc) cannot convert typed arguments to a receiver it only
 * knows as a dynamic value (SC1101).
 */
function memoryQuadsOf(
  memory: MemoryStore,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null,
): RdfQuad[] {
  return memory.getQuads(s, p, o, g);
}

/**
 * memoryQuads answers the pattern from an indexed MemoryStore underneath any
 * number of graph scopes, or null when the store is not one (the caller then
 * falls back to the RDF/JS stream). It returns quads, never the store: the
 * native compiler (scriptc) cannot represent a program class instance in a
 * checked-dynamic slot or union (`MemoryStore | null`), so narrowing happens
 * in place and only the plain `RdfQuad[]` result crosses the boundary.
 */
function memoryQuads(
  source: rdfjs.Source<RdfQuad>,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null,
): RdfQuad[] | null {
  if (source instanceof MemoryStore) {
    return memoryQuadsOf(source, s, p, o, g);
  }
  if (source instanceof GraphScopedStore) {
    return memoryQuads(source.sourceStore, s, p, o, g);
  }
  return null;
}

/** resolveMatchGraph picks the graph argument for store.match / getQuads. */
function resolveMatchGraph(
  store: rdfjs.Source<RdfQuad>,
  g: RdfTerm | null,
): RdfTerm | null {
  if (g !== null) {
    return g;
  }
  if (store instanceof GraphScopedStore) {
    return resolveGraphScope(store);
  }
  return null;
}

/**
 * matchQuads collects all quads matching the given pattern from an RDF/JS
 * store, resolving the store's match stream into an array.
 */
export function matchQuads(
  store: rdfjs.Source<RdfQuad>,
  s: RdfTerm | null,
  p: RdfTerm | null,
  o: RdfTerm | null,
  g: RdfTerm | null = null,
): Promise<RdfQuad[]> {
  const graphTerm = resolveMatchGraph(store, g);
  const quads = memoryQuads(store, s, p, o, graphTerm);
  if (quads !== null) {
    return Promise.resolve(quads);
  }
  return matchQuadsViaStream(store, s, p, o, graphTerm);
}

/**
 * graphTermFromDescriptor rebuilds a graph term from the (termType, value)
 * pair a GraphScopedStore carries. The view keeps its scope as strings so a
 * narrowed view never has to hand a class value to a dynamic slot, which the
 * native (scriptc) build cannot represent.
 */
export function graphTermFromDescriptor(
  termType: string,
  value: string,
): RdfQuadGraph {
  if (termType === "DefaultGraph") {
    return defaultGraphInstance;
  }
  if (termType === "BlankNode") {
    return DataFactory.blankNode(value);
  }
  return DataFactory.namedNode(value);
}

/** resolveGraphScope returns the active graph term for store scans. */
export function resolveGraphScope(
  store: rdfjs.Source<RdfQuad>,
): RdfQuadGraph {
  if (store instanceof GraphScopedStore) {
    return graphTermFromDescriptor(store.graphTermType, store.graphValue);
  }
  return defaultGraphInstance;
}

/**
 * isSimplePredicate narrows a predicate to a simple (term) predicate,
 * excluding property-path predicates.
 */
function isSimplePredicate(
  predicate: TriplePredicate,
): predicate is SparqlTerm {
  return (
    typeof predicate === "object" && predicate !== null &&
    "termType" in predicate
  );
}

/**
 * simplePredicate returns the predicate of a triple pattern or template,
 * rejecting property-path predicates that the engine does not support.
 */
export function simplePredicate(predicate: TriplePredicate): SparqlTerm {
  if (!isSimplePredicate(predicate)) {
    throw new Error(
      "Unsupported property path predicate: only simple predicates are supported",
    );
  }
  return predicate;
}
/**
 * GraphScopedStore is a read-only RDF/JS store view that fixes the graph
 * term of every scan. The whole evaluation pipeline (BGP joins, property
 * paths, graph node enumeration) runs against one named graph through it
 * without any call site knowing the scope exists.
 */
export class GraphScopedStore implements rdfjs.Source<RdfQuad> {
  public constructor(
    private readonly store: rdfjs.Source<RdfQuad>,
    graph: RdfQuadGraph,
  ) {
    this.graphTermType = graph.termType;
    this.graphValue = graph.value;
  }

  /** graphTermType is the scope's term type, kept as a plain string. */
  public readonly graphTermType: string;

  /** graphValue is the scope's term value, kept as a plain string. */
  public readonly graphValue: string;

  /** graph rebuilds the scope's graph term from its string fields. */
  public graph(): RdfQuadGraph {
    return graphTermFromDescriptor(this.graphTermType, this.graphValue);
  }

  /** version delegates to the wrapped store so snapshot caches see through
   * the view (the view itself never mutates the data). */
  public get version(): number | null {
    return storeVersion(this.store);
  }

  /**
   * estimateStats delegates to the wrapped store's statistics hook (issue
   * #129), mirroring version. The PatternStatistics source consults it only
   * at the default-graph scope — a named scope derives exact stats from its
   * scoped candidates instead, since the hook cannot see the scope.
   */
  public estimateStats?(
    pattern: Triple,
  ): PatternStats | Promise<PatternStats | undefined> | undefined {
    return estimateStatsViaStore(this.store, pattern);
  }

  /** sourceStore is the dataset store this graph view wraps. */
  public get sourceStore(): rdfjs.Source<RdfQuad> {
    return this.store;
  }

  public match(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): rdfjs.Stream<RdfQuad> {
    // An explicit graph wins; otherwise the view's fixed graph applies. The
    // pipeline always scans with a null graph, so the scope is applied, and
    // nested scopes (GRAPH inside GRAPH) compose correctly.
    return matchQuadStream(
      this.store,
      subject,
      predicate,
      object,
      graph ?? this.graph(),
    );
  }
}

/**
 * namedGraphs returns every named graph present in the store (quads whose
 * graph term is not the default graph), for GRAPH ?g evaluation.
 */
export async function namedGraphs(
  store: rdfjs.Source<RdfQuad>,
): Promise<RdfQuadGraph[]> {
  const quads = await matchQuads(store, null, null, null);
  const graphs = new Map<string, RdfQuadGraph>();
  for (const item of quads) {
    if (item.graph.termType !== "DefaultGraph") {
      graphs.set(termKey(item.graph), item.graph);
    }
  }
  return [...graphs.values()];
}

/**
 * buildDatasetStore materializes the SPARQL 1.1 active dataset for a query
 * with FROM / FROM NAMED clauses: the default graph is the merge of the
 * quads of every FROM graph (deduplicated, re-graphed to the default graph,
 * empty when no FROM is given), and the named graphs are exactly the FROM
 * NAMED graphs (empty when none are given). Returning a real store means the
 * whole evaluation pipeline — BGP scans, property paths, GRAPH enumeration —
 * runs against the dataset with no special-casing; quads outside the
 * dataset simply do not exist in the view.
 */
export async function buildDatasetStore(
  store: rdfjs.Source<RdfQuad>,
  from: readonly RdfTerm[],
  fromNamed: readonly RdfTerm[],
): Promise<rdfjs.Store> {
  const dataset = new MemoryStore();
  const seen = new Set<string>();
  for (const graph of from) {
    const quads = await matchQuads(store, null, null, null, graph);
    for (const item of quads) {
      const key = quadDedupKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        dataset.addQuad(
          DataFactory.quad(
            item.subject,
            item.predicate,
            item.object,
            DataFactory.defaultGraph(),
          ),
        );
      }
    }
  }
  for (const graph of fromNamed) {
    const quads = await matchQuads(store, null, null, null, graph);
    for (const item of quads) {
      dataset.addQuad(item);
    }
  }
  return dataset;
}

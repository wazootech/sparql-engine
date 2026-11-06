import type {
  RdfQuad,
  RdfQuadGraph,
  RdfSource,
  RdfStore,
  RdfStream,
  RdfTerm,
} from "@/parser/rdf-terms.ts";
import { defaultGraphInstance } from "@/term/data-factory.ts";
import { quadDedupKey } from "@/term/quad-narrow.ts";
import { matchQuadStream } from "@/store/quad-stream.ts";
import { estimateStatsViaStore } from "@/store/store-statistics.ts";
import { DataFactory, termKey } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import type { PatternStats } from "@/planner/pattern-statistics.ts";
import type { Triple } from "@/parser/sparql-parser.ts";
import { matchQuads, storeVersion } from "@/quad-match.ts";
import { asGraphScopedStore, storeKindOf } from "@/store-kind.ts";

/**
 * GraphScopedStore is a read-only RDF/JS store view that fixes the graph
 * term of every scan. The whole evaluation pipeline (BGP joins, property
 * paths, graph node enumeration) runs against one named graph through it
 * without any call site knowing the scope exists.
 */
export class GraphScopedStore implements RdfSource<RdfQuad> {
  /** kind marks this store as a graph-scoped view (see StoreKind). */
  public readonly kind = "graph-scoped" as const;

  public constructor(
    private readonly store: RdfSource<RdfQuad>,
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
  public get sourceStore(): RdfSource<RdfQuad> {
    return this.store;
  }

  public match(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): RdfStream<RdfQuad> {
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
  store: RdfSource<RdfQuad>,
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
  store: RdfSource<RdfQuad>,
  from: readonly RdfTerm[],
  fromNamed: readonly RdfTerm[],
): Promise<RdfStore> {
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
  store: RdfSource<RdfQuad>,
): RdfQuadGraph {
  if (storeKindOf(store) === "graph-scoped") {
    const scoped = asGraphScopedStore(store);
    return graphTermFromDescriptor(scoped.graphTermType, scoped.graphValue);
  }
  return defaultGraphInstance;
}

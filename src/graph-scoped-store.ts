import type * as rdfjs from "@rdfjs/types";
import { DataFactory, termKey } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import type {
  PatternStats,
  StoreStatisticsHook,
} from "@/planner/pattern-statistics.ts";
import type { Triple } from "@/parser/sparql-parser.ts";
import { matchQuads, storeVersion } from "@/quad-match.ts";

/**
 * GraphScopedStore is a read-only RDF/JS store view that fixes the graph
 * term of every scan. The whole evaluation pipeline (BGP joins, property
 * paths, graph node enumeration) runs against one named graph through it
 * without any call site knowing the scope exists.
 */
export class GraphScopedStore implements rdfjs.Source<rdfjs.Quad> {
  public constructor(
    private readonly store: rdfjs.Source<rdfjs.Quad>,
    public readonly graph: rdfjs.Term,
  ) {}

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
    const hook = (this.store as StoreStatisticsHook).estimateStats;
    if (typeof hook !== "function") {
      return undefined;
    }
    return hook.call(this.store, pattern);
  }

  public match(
    subject?: rdfjs.Term | null,
    predicate?: rdfjs.Term | null,
    object?: rdfjs.Term | null,
    graph?: rdfjs.Term | null,
  ): rdfjs.Stream<rdfjs.Quad> {
    // An explicit graph wins; otherwise the view's fixed graph applies. The
    // pipeline always scans with a null graph, so the scope is applied, and
    // nested scopes (GRAPH inside GRAPH) compose correctly.
    return this.store.match(subject, predicate, object, graph ?? this.graph);
  }
}

/**
 * namedGraphs returns every named graph present in the store (quads whose
 * graph term is not the default graph), for GRAPH ?g evaluation.
 */
export async function namedGraphs(
  store: rdfjs.Source<rdfjs.Quad>,
): Promise<rdfjs.Quad_Graph[]> {
  const quads = await matchQuads(store, null, null, null);
  const graphs = new Map<string, rdfjs.Quad_Graph>();
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
  store: rdfjs.Source<rdfjs.Quad>,
  from: readonly rdfjs.Term[],
  fromNamed: readonly rdfjs.Term[],
): Promise<rdfjs.Store> {
  const dataset = new MemoryStore();
  const seen = new Set<string>();
  for (const graph of from) {
    const quads = await matchQuads(store, null, null, null, graph);
    for (const item of quads) {
      const key = termKey(item);
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

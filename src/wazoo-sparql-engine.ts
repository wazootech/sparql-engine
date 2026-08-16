import type * as rdfjs from "@rdfjs/types";
import type {
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
} from "@/sparql-engine-interface.ts";
import { SparqlParser } from "@/parser/sparql-parser.ts";
import type { SparqlQuery } from "@/parser/ast.ts";
import { SparqlEvaluator } from "@/evaluator/sparql-evaluator.ts";
import { UpdateEvaluator } from "@/evaluator/update-evaluator.ts";
import type { IriFunctionMap } from "@/evaluator/expression-evaluator.ts";
import type { JoinCostEstimator } from "@/planner/join-cost-estimator.ts";

export type {
  IriFunction,
  IriFunctionMap,
} from "@/evaluator/expression-evaluator.ts";

/**
 * WazooSparqlTransaction is the minimal write contract the engine uses for updates.
 * It mirrors the structural shape of @worlds/client's Transaction so durable
 * backends can pass their existing transaction objects.
 */
export interface WazooSparqlTransaction {
  /** add buffers a single quad for insertion on the next commit. */
  add(quad: rdfjs.Quad): unknown;

  /** delete buffers a single quad for deletion on the next commit. */
  delete(quad: rdfjs.Quad): unknown;

  /** commit persists the buffered patch. */
  commit(): Promise<void>;

  /** rollback discards any uncommitted insertions and deletions. */
  rollback(): void;
}

/**
 * WazooSparqlEngineOptions configures WazooSparqlEngine.
 */
export interface WazooSparqlEngineOptions {
  /** store is the RDFJS store to execute queries on. */
  store: rdfjs.Store;

  /**
   * createTransaction is an optional factory to create a transaction for SPARQL
   * UPDATEs. When provided, every update runs through one atomic transaction.
   * When omitted, updates are applied directly to the store, which must then
   * implement addQuad/removeQuad (as MemoryStore does).
   */
  createTransaction?: () => WazooSparqlTransaction;

  /**
   * reorderPatterns statically sorts BGP triple patterns by selectivity
   * (constant count) before joining, so the most selective pattern runs
   * first. Defaults to true. Disabling it preserves written order exactly.
   */
  reorderPatterns?: boolean;

  /**
   * functions registers custom IRI functions (SPARQL 1.1 §17.4.3.1): a map
   * from function IRI to evaluator, injected like Comunica's function
   * factory. A registered function receives its evaluated arguments and
   * returns a term, or undefined for a type error (FILTER drops the row,
   * ORDER BY sorts it lowest). Unregistered IRIs keep raising
   * "Unsupported SPARQL expression: functionCall".
   */
  functions?: IriFunctionMap;

  /**
   * estimator supplies the BGP join-cost estimator (see JoinCostEstimator);
   * defaults to the baseline formula, whose costs match the DP join-order
   * search (issue #130) — small BGPs get the globally optimal order, larger
   * ones the greedy stepwise choice. An injected custom estimator keeps the
   * greedy loop. Only affects join order, never results.
   */
  estimator?: JoinCostEstimator;
}

/**
 * WazooSparqlEngine is the Wazoo SPARQL 1.1 & 1.2 engine over RDFJS Store sources.
 */
export class WazooSparqlEngine implements SparqlEngineInterface {
  private readonly parser: SparqlParser;
  private readonly evaluator: SparqlEvaluator;
  private readonly updateEvaluator: UpdateEvaluator;
  /**
   * Bounded cache of parsed queries keyed by the exact request string.
   * Parsing measured ~40% of a sub-millisecond execute, and the AST is only
   * ever read by the evaluators (never mutated), so repeated queries reuse
   * the parse. Map preserves insertion order, giving cheap FIFO eviction.
   */
  private readonly queryCache = new Map<string, SparqlQuery>();
  private static readonly QUERY_CACHE_MAX = 128;

  public constructor(
    private readonly options: WazooSparqlEngineOptions,
  ) {
    this.parser = new SparqlParser();
    this.evaluator = new SparqlEvaluator(options.store, {
      reorderPatterns: options.reorderPatterns,
      functions: options.functions,
      estimator: options.estimator,
    });
    this.updateEvaluator = new UpdateEvaluator({
      store: options.store,
      createTransaction: options.createTransaction,
      reorderPatterns: options.reorderPatterns,
      estimator: options.estimator,
    });
  }

  /** execute runs a SPARQL query/update against the configured store. */
  public async execute(request: SparqlRequest): Promise<SparqlResponse> {
    const raw = request.query;
    const baseIri = request.baseIri;
    // The parse depends on the base (the grammar resolves prefix IRIs and
    // records query.base from it), so the cache key carries it.
    const cacheKey = baseIri === undefined ? raw : `${raw}\u0000${baseIri}`;
    let ast = this.queryCache.get(cacheKey);
    if (ast === undefined) {
      ast = this.parser.parse(
        raw,
        baseIri === undefined ? undefined : { baseIRI: baseIri },
      );
      this.queryCache.set(cacheKey, ast);
      if (this.queryCache.size > WazooSparqlEngine.QUERY_CACHE_MAX) {
        const oldest = this.queryCache.keys().next().value;
        if (oldest !== undefined) {
          this.queryCache.delete(oldest);
        }
      }
    }
    if (ast.type === "update") {
      // The parser folds the request base into the AST when the query has
      // no BASE directive, so ast.base is the effective base either way.
      await this.updateEvaluator.executeUpdate(ast, ast.base ?? baseIri);
      return { kind: "void" };
    }
    return await this.evaluator.evaluateQuery(ast);
  }
}

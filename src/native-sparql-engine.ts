import type * as rdfjs from "@rdfjs/types";
import type {
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
} from "@/sparql-engine-interface.ts";
import { SparqlParser } from "@/parser/sparql-parser.ts";
import { SparqlEvaluator } from "@/evaluator/sparql-evaluator.ts";
import { UpdateEvaluator } from "@/evaluator/update-evaluator.ts";

/**
 * NativeSparqlTransaction is the minimal write contract the engine uses for updates.
 * It mirrors the structural shape of @worlds/client's Transaction so durable
 * backends can pass their existing transaction objects.
 */
export interface NativeSparqlTransaction {
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
 * NativeSparqlEngineOptions configures NativeSparqlEngine.
 */
export interface NativeSparqlEngineOptions {
  /** store is the RDFJS store to execute queries on. */
  store: rdfjs.Store;

  /**
   * createTransaction is an optional factory to create a transaction for SPARQL
   * UPDATEs. When provided, every update runs through one atomic transaction.
   * When omitted, updates are applied directly to the store, which must then
   * implement addQuad/removeQuad (as N3.Store does).
   */
  createTransaction?: () => NativeSparqlTransaction;

  /**
   * reorderPatterns statically sorts BGP triple patterns by selectivity
   * (constant count) before joining, so the most selective pattern runs
   * first. Defaults to true. Disabling it preserves written order exactly.
   */
  reorderPatterns?: boolean;
}

/**
 * NativeSparqlEngine is the Wazoo-native SPARQL 1.1 engine over RDFJS Store sources.
 */
export class NativeSparqlEngine implements SparqlEngineInterface {
  private readonly parser: SparqlParser;
  private readonly evaluator: SparqlEvaluator;
  private readonly updateEvaluator: UpdateEvaluator;

  public constructor(
    private readonly options: NativeSparqlEngineOptions,
  ) {
    this.parser = new SparqlParser();
    this.evaluator = new SparqlEvaluator(options.store, {
      reorderPatterns: options.reorderPatterns,
    });
    this.updateEvaluator = new UpdateEvaluator({
      store: options.store,
      createTransaction: options.createTransaction,
      reorderPatterns: options.reorderPatterns,
    });
  }

  /** execute runs a SPARQL query/update against the configured store. */
  public async execute(request: SparqlRequest): Promise<SparqlResponse> {
    const raw = request.query ?? request.update;
    if (!raw) {
      throw new Error("SparqlRequest must specify either query or update");
    }
    const ast = this.parser.parse(raw);
    if (ast.type === "update") {
      await this.updateEvaluator.executeUpdate(ast);
      return { kind: "void" };
    }
    return await this.evaluator.evaluateQuery(ast);
  }
}

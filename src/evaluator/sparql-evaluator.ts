import type * as rdfjs from "@rdfjs/types";
import type {
  AskQuery,
  ConstructQuery,
  Expression,
  SelectQuery,
  SparqlQuery,
  Term as SparqlTerm,
} from "sparqljs";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlResponse,
  SparqlSelectResults,
} from "@/sparql-engine-interface.ts";
import { BgpEvaluator } from "@/evaluator/bgp-evaluator.ts";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import { simplePredicate } from "@/quad-store.ts";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import {
  compareRdfTerms,
  rdfTermToSparqlValue,
  sparqlTermToRdfTerm,
} from "@/term/mod.ts";
import { DataFactory } from "n3";

/**
 * SparqlEvaluatorOptions configures SparqlEvaluator.
 */
export interface SparqlEvaluatorOptions {
  /**
   * reorderPatterns statically sorts BGP triple patterns by selectivity before
   * joining. Defaults to true. See BgpEvaluatorOptions.reorderPatterns.
   */
  reorderPatterns?: boolean;
}

/**
 * SparqlEvaluator processes parsed SPARQL AST queries against an RDFJS store.
 */
export class SparqlEvaluator {
  private readonly bgpEvaluator: BgpEvaluator;

  /** expressionEvaluator evaluates ORDER BY expressions against solutions. */
  private readonly expressionEvaluator = new ExpressionEvaluator();

  public constructor(
    store: rdfjs.Store,
    options: SparqlEvaluatorOptions = {},
  ) {
    this.bgpEvaluator = new BgpEvaluator(store, {
      reorderPatterns: options.reorderPatterns,
    });
  }

  /**
   * evaluateQuery processes a parsed SPARQL query and produces a typed SparqlResponse.
   */
  public async evaluateQuery(query: SparqlQuery): Promise<SparqlResponse> {
    switch (query.type) {
      case "query":
        switch (query.queryType) {
          case "SELECT":
            return { kind: "select", data: await this.evaluateSelect(query) };
          case "ASK":
            return { kind: "ask", data: await this.evaluateAsk(query) };
          case "CONSTRUCT":
            return {
              kind: "construct",
              data: await this.evaluateConstruct(query),
            };
          default:
            throw new Error(`Unsupported query type: ${query.queryType}`);
        }
      default:
        throw new Error(`Unsupported SPARQL operation type: ${query.type}`);
    }
  }

  private async evaluateSelect(
    query: SelectQuery,
  ): Promise<SparqlSelectResults> {
    const rawBindings = await this.bgpEvaluator.evaluateBgp(query.where || []);
    const vars: string[] = [];
    const projections = new Map<string, Expression>();

    for (const v of query.variables) {
      if (
        typeof v === "object" && "termType" in v && v.termType === "Variable"
      ) {
        vars.push(v.value);
      } else if (typeof v === "string") {
        vars.push(v);
      } else if ("variable" in v && v.variable) {
        vars.push(v.variable.value);
        projections.set(v.variable.value, v.expression);
      }
    }

    const ordered = query.order?.length
      ? this.orderBindings(rawBindings, query.order)
      : rawBindings;

    // Bindings travel internally as RDF/JS terms; this projection is the
    // single point where they become the SparqlValue wire format. Projection
    // expressions ((expr AS ?v)) are evaluated here; an error leaves the
    // variable unbound, matching SPARQL 1.1 semantics.
    const filteredBindings: SparqlBinding[] = ordered.map((binding) => {
      const projected: SparqlBinding = {};
      for (const varName of vars) {
        const bound = binding[varName];
        if (bound) {
          projected[varName] = rdfTermToSparqlValue(bound);
        }
        const projection = projections.get(varName);
        if (projection !== undefined && !(varName in projected)) {
          const value = this.expressionEvaluator.evaluate(projection, binding);
          if (value !== undefined) {
            projected[varName] = rdfTermToSparqlValue(value);
          }
        }
      }
      return projected;
    });

    return {
      head: { vars },
      results: { bindings: filteredBindings },
    };
  }

  private async evaluateAsk(query: AskQuery): Promise<SparqlAskResults> {
    const bindings = await this.bgpEvaluator.evaluateBgp(query.where || []);
    return {
      head: { link: null },
      boolean: bindings.length > 0,
    };
  }

  private async evaluateConstruct(
    query: ConstructQuery,
  ): Promise<SparqlConstructResults> {
    const bindings = await this.bgpEvaluator.evaluateBgp(query.where || []);
    const quads: rdfjs.Quad[] = [];

    if (!query.template) {
      return { quads };
    }

    for (const binding of bindings) {
      for (const t of query.template) {
        const s = this.resolveConstructTerm(t.subject, binding);
        const p = this.resolveConstructTerm(
          simplePredicate(t.predicate),
          binding,
        );
        const o = this.resolveConstructTerm(t.object, binding);

        if (s && p && o) {
          quads.push(
            DataFactory.quad(
              s as rdfjs.Quad_Subject,
              p as rdfjs.Quad_Predicate,
              o as rdfjs.Quad_Object,
              DataFactory.defaultGraph(),
            ),
          );
        }
      }
    }

    return { quads };
  }

  /**
   * orderBindings sorts term bindings by the query's ORDER BY clauses, using
   * the term module's ordering (unbound lowest, then blank nodes, IRIs, and
   * literals; literals by datatype, numeric value, then lexical form).
   * Comparison is stable, so ties keep the evaluation order. Only variable
   * and constant-term expressions are supported; anything else (function
   * calls, arithmetic) has no expression evaluator yet and raises a clear
   * error.
   */
  private orderBindings(
    bindings: TermBinding[],
    order: NonNullable<SelectQuery["order"]>,
  ): TermBinding[] {
    const comparators = order.map((clause) => ({
      descending: clause.descending === true,
      resolve: (binding: TermBinding): rdfjs.Term | undefined =>
        this.expressionEvaluator.evaluate(clause.expression, binding),
    }));
    return [...bindings].sort((a, b) => {
      for (const comparator of comparators) {
        const result = compareRdfTerms(
          comparator.resolve(a),
          comparator.resolve(b),
        );
        if (result !== 0) {
          return comparator.descending ? -result : result;
        }
      }
      return 0;
    });
  }

  private resolveConstructTerm(
    term: SparqlTerm,
    binding: TermBinding,
  ): rdfjs.Term | null {
    if (term.termType === "Variable") {
      const bound = binding[term.value];
      if (bound) {
        return bound;
      }
      return null;
    }
    return sparqlTermToRdfTerm(term);
  }
}

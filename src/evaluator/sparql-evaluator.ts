import type * as rdfjs from "@rdfjs/types";
import type {
  AskQuery,
  ConstructQuery,
  SelectQuery,
  SparqlQuery,
} from "sparqljs";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlResponse,
  SparqlSelectResults,
} from "@/sparql-engine-interface.ts";
import { BgpEvaluator } from "@/evaluator/bgp-evaluator.ts";

/**
 * SparqlEvaluator processes parsed SPARQL AST queries against an RDFJS store.
 */
export class SparqlEvaluator {
  private readonly bgpEvaluator: BgpEvaluator;

  public constructor(store: rdfjs.Store) {
    this.bgpEvaluator = new BgpEvaluator(store);
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

    for (const v of query.variables) {
      if (
        typeof v === "object" && "termType" in v && v.termType === "Variable"
      ) {
        vars.push(v.value);
      } else if (typeof v === "string") {
        vars.push(v);
      } else if ("variable" in v && v.variable) {
        vars.push(v.variable.value);
      }
    }

    const filteredBindings: SparqlBinding[] = rawBindings.map((binding) => {
      const projected: SparqlBinding = {};
      for (const varName of vars) {
        if (binding[varName]) {
          projected[varName] = binding[varName];
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

    for (const _binding of bindings) {
      for (const t of query.template) {
        const _s = this.bgpEvaluator.sparqlValueToRdfTerm(
          this.bgpEvaluator.rdfTermToSparqlValue(
            this.bgpEvaluator.sparqlTermToRdfTerm(t.subject),
          ),
        );
        const _p = this.bgpEvaluator.sparqlValueToRdfTerm(
          this.bgpEvaluator.rdfTermToSparqlValue(
            this.bgpEvaluator.sparqlTermToRdfTerm(t.predicate),
          ),
        );
        const _o = this.bgpEvaluator.sparqlValueToRdfTerm(
          this.bgpEvaluator.rdfTermToSparqlValue(
            this.bgpEvaluator.sparqlTermToRdfTerm(t.object),
          ),
        );
        // Note: quad production will be refined in Phase 2
      }
    }

    return { quads };
  }
}

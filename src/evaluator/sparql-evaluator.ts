import type * as rdfjs from "@rdfjs/types";
import type {
  AskQuery,
  ConstructQuery,
  SelectQuery,
  SparqlQuery,
  Term as SparqlTerm,
  Triple,
} from "sparqljs";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlResponse,
  SparqlSelectResults,
} from "@/sparql-engine-interface.ts";
import { BgpEvaluator } from "@/evaluator/bgp-evaluator.ts";
import { DataFactory } from "n3";

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

    for (const binding of bindings) {
      for (const t of query.template) {
        const s = this.resolveConstructTerm(t.subject, binding);
        const p = this.resolveConstructTerm(
          this.resolveTemplatePredicate(t.predicate),
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

  private resolveTemplatePredicate(predicate: Triple["predicate"]): SparqlTerm {
    if ("termType" in predicate) {
      return predicate;
    }
    throw new Error(
      `Unsupported property path predicate in CONSTRUCT template`,
    );
  }

  private resolveConstructTerm(
    term: Parameters<BgpEvaluator["sparqlTermToRdfTerm"]>[0],
    binding: SparqlBinding,
  ): rdfjs.Term | null {
    if (term.termType === "Variable") {
      const bound = binding[term.value];
      if (bound) {
        return this.bgpEvaluator.sparqlValueToRdfTerm(bound);
      }
      return null;
    }
    return this.bgpEvaluator.sparqlTermToRdfTerm(term);
  }
}

import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  AskQuery,
  ConstructQuery,
  Expression,
  Pattern,
  SelectQuery,
  SparqlQuery,
  Term as SparqlTerm,
} from "@/parser/sparql-parser.ts";
import type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlResponse,
  SparqlSelectResults,
} from "@/sparql-engine-interface.ts";
import { aggregateValue, groupSolutions } from "@/evaluator/aggregate.ts";
import { innerJoin } from "@/evaluator/join.ts";
import { expandReifiedTriples } from "@/evaluator/reified.ts";
import {
  BgpEvaluator,
  expressionContainsExists,
} from "@/evaluator/bgp-evaluator.ts";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import { buildDatasetStore, simplePredicate } from "@/quad-store.ts";
import { ExpressionEvaluator } from "@/evaluator/expression-evaluator.ts";
import type { ExpressionEvaluationContext } from "@/evaluator/expression-evaluator.ts";
import {
  compareRdfTerms,
  rdfTermToSparqlValue,
  sparqlTermToRdfTerm,
  termKey,
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
 * SelectSolution is one SELECT output row: the binding to project plus,
 * when the query has GROUP BY, the group's raw solutions that aggregates
 * resolve over (null when ungrouped).
 */
type SelectSolution = {
  binding: TermBinding;
  group: TermBinding[] | null;
};

/**
 * SparqlEvaluator processes parsed SPARQL AST queries against an RDFJS store.
 */
export class SparqlEvaluator {
  private readonly bgpEvaluator: BgpEvaluator;

  /** expressionEvaluator evaluates ORDER BY expressions against solutions. */
  private readonly expressionEvaluator = new ExpressionEvaluator();

  /**
   * nextConstructBnodeId mints fresh labels for CONSTRUCT template blank
   * nodes, which must be distinct per solution mapping (SPARQL 1.1 §16.2.1).
   */
  private nextConstructBnodeId = 0;

  private readonly store: rdfjs.Source<rdfjs.Quad>;

  public constructor(
    store: rdfjs.Source<rdfjs.Quad>,
    options: SparqlEvaluatorOptions = {},
  ) {
    this.store = store;
    this.bgpEvaluator = new BgpEvaluator(store, {
      reorderPatterns: options.reorderPatterns,
    });
  }

  /**
   * bgpEvaluatorFor returns the evaluator for a query's WHERE clause: the
   * shared one when the query has no FROM / FROM NAMED clauses, otherwise a
   * fresh evaluator over the materialized active dataset (SPARQL 1.1 §13.1:
   * FROM graphs merge into the default graph, FROM NAMED graphs become the
   * dataset's named graphs).
   */
  private async bgpEvaluatorFor(
    from: { default: SparqlTerm[]; named: SparqlTerm[] } | undefined,
  ): Promise<BgpEvaluator> {
    if (
      from === undefined ||
      (from.default.length === 0 && from.named.length === 0)
    ) {
      return this.bgpEvaluator;
    }
    const dataset = await buildDatasetStore(
      this.store,
      from.default.map((term) => sparqlTermToRdfTerm(term)),
      from.named.map((term) => sparqlTermToRdfTerm(term)),
    );
    return this.bgpEvaluator.forStore(dataset);
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

  public async evaluateSelectTermBindings(
    query: SelectQuery,
  ): Promise<TermBinding[]> {
    const evaluator = await this.bgpEvaluatorFor(query.from);
    let rawBindings = await evaluator.evaluateBgp(query.where || []);

    if (query.values !== undefined && query.values.length > 0) {
      const rows: TermBinding[] = query.values.map((row) => {
        const binding: TermBinding = {};
        for (const name of Object.keys(row)) {
          const term = row[name];
          if (term !== undefined) {
            binding[name.slice(1)] = sparqlTermToRdfTerm(term);
          }
        }
        return binding;
      });
      rawBindings = innerJoin(rawBindings, rows);
    }
    const vars: string[] = [];
    const projections = new Map<string, Expression>();
    let wildcard = false;

    for (const v of query.variables) {
      if (typeof v === "string") {
        vars.push(v);
      } else if ("termType" in v && v.termType === "Variable") {
        vars.push(v.value);
      } else if ("variable" in v && v.variable) {
        vars.push(v.variable.value);
        projections.set(v.variable.value, v.expression);
      } else {
        wildcard = true;
      }
    }

    if (
      [...projections.values()].some(expressionContainsExists) ||
      (query.order ?? []).some((clause) =>
        expressionContainsExists(clause.expression)
      ) ||
      (query.having ?? []).some(expressionContainsExists)
    ) {
      await evaluator.prepareExistsIndex();
    }
    const existsContext: ExpressionEvaluationContext = {
      evaluateExists: (pattern, solution) =>
        evaluator.evaluateExists(pattern, solution),
      baseIri: query.base,
    };

    const grouping = query.group ?? [];
    const hasGrouping = grouping.length > 0;
    const hasAggregates =
      [...projections.values()].some((expression) =>
        expressionContainsAggregate(expression)
      ) ||
      (query.order ?? []).some((clause) =>
        expressionContainsAggregate(clause.expression)
      ) ||
      (query.having ?? []).some(expressionContainsAggregate);
    let solutions: SelectSolution[];
    if (hasGrouping || hasAggregates) {
      const groups = hasGrouping
        ? groupSolutions(
          rawBindings,
          grouping,
          (expression, binding) =>
            this.expressionEvaluator.evaluate(
              expression,
              binding,
              existsContext,
            ),
        )
        : [{ key: {}, solutions: rawBindings }];
      const grouped: SelectSolution[] = groups.map((group) => ({
        binding: group.key,
        group: group.solutions,
      }));
      solutions = query.having !== undefined && query.having.length > 0
        ? grouped.filter((solution) =>
          query.having!.every((expression) =>
            this.havingPasses(expression, solution, existsContext)
          )
        )
        : grouped;
    } else {
      solutions = rawBindings.map((binding) => ({
        binding,
        group: null,
      }));
    }

    const ordered = query.order?.length
      ? this.orderBindings(solutions, query.order, existsContext)
      : solutions;

    const projected: TermBinding[] = ordered.map((solution) =>
      this.projectSolutionToTermBinding(
        solution,
        wildcard,
        vars,
        projections,
        existsContext,
      )
    );

    let filteredBindings = projected;
    // REDUCED is a permitted hint to drop duplicates; per the REDUCED decision
    // it is implemented as full dedup (REDUCED ≡ DISTINCT), which is strictly
    // stronger than the spec floor and matches Comunica/Oxigraph on ≤100-
    // distinct inputs.
    if (query.distinct || query.reduced) {
      const seen = new Set<string>();
      filteredBindings = filteredBindings.filter((b) => {
        const key = Object.keys(b).sort().map((k) => `${k}:${termKey(b[k])}`)
          .join("\u0000");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (query.offset !== undefined) {
      filteredBindings = filteredBindings.slice(query.offset);
    }
    if (query.limit !== undefined) {
      filteredBindings = filteredBindings.slice(0, query.limit);
    }
    return filteredBindings.map((b) => {
      const clean: TermBinding = {};
      for (const k of Object.keys(b)) {
        if (!k.startsWith("_:")) {
          clean[k] = b[k];
        }
      }
      return clean;
    });
  }

  private async evaluateSelect(
    query: SelectQuery,
  ): Promise<SparqlSelectResults> {
    const termBindings = await this.evaluateSelectTermBindings(query);
    const projected: SparqlBinding[] = termBindings.map((b) => {
      const sb: SparqlBinding = {};
      for (const k of Object.keys(b)) {
        sb[k] = rdfTermToSparqlValue(b[k]);
      }
      return sb;
    });

    const vars: string[] = [];
    let wildcard = false;
    for (const v of query.variables) {
      if (typeof v === "string") {
        vars.push(v);
      } else if ("termType" in v && v.termType === "Variable") {
        vars.push(v.value);
      } else if ("variable" in v && v.variable) {
        vars.push(v.variable.value);
      } else {
        wildcard = true;
      }
    }

    return {
      head: {
        vars: wildcard
          ? Array.from(
            new Set(projected.flatMap((binding) => Object.keys(binding))),
          )
          : vars,
      },
      results: { bindings: projected },
    };
  }

  /**
   * havingPasses applies one HAVING expression to a grouped solution: the
   * expression is evaluated with aggregate resolution over the group and
   * its EBV must be true (false and errors both drop the group).
   */
  private havingPasses(
    expression: Expression,
    solution: SelectSolution,
    context?: ExpressionEvaluationContext,
  ): boolean {
    if (solution.group === null) {
      return false;
    }
    return this.expressionEvaluator.filterPassesWithAggregates(
      expression,
      solution.binding,
      this.aggregateResolver(solution, context),
      context,
    );
  }

  /**
   * aggregateResolver returns the aggregate resolver for a grouped solution:
   * each aggregate expression evaluates over the group's raw solutions.
   */
  private aggregateResolver(
    solution: SelectSolution,
    context?: ExpressionEvaluationContext,
  ): (aggregate: AggregateExpression) => rdfjs.Term | undefined {
    const group = solution.group;
    if (group === null) {
      return () => undefined;
    }
    return (aggregate) =>
      aggregateValue(
        aggregate,
        group,
        (expression, binding) =>
          this.expressionEvaluator.evaluate(expression, binding, context),
      );
  }

  /**
   * projectSolution renders one solution (raw or grouped) to the wire
   * format. Projected variables resolve from the solution's binding (group
   * key variables are bound by grouping); projection expressions evaluate
   * with the solution's aggregate resolver when it is grouped.
   */
  private projectSolutionToTermBinding(
    solution: SelectSolution,
    wildcard: boolean,
    vars: string[],
    projections: Map<string, Expression>,
    context?: ExpressionEvaluationContext,
  ): TermBinding {
    const binding = solution.binding;
    const result: TermBinding = {};
    if (wildcard) {
      for (const varName of Object.keys(binding)) {
        result[varName] = binding[varName];
      }
      return result;
    }
    // BNODE(str) scopes its blank nodes to a single solution mapping, so each
    // solution's projection carries a fresh bnode cache (SPARQL 1.1 §17.4.1.5).
    const solutionContext: ExpressionEvaluationContext = {
      ...(context ?? {}),
      bnodeMap: new Map<string, rdfjs.BlankNode>(),
    };
    const resolver = solution.group === null
      ? undefined
      : this.aggregateResolver(solution, solutionContext);
    for (const varName of vars) {
      const bound = binding[varName];
      if (bound) {
        result[varName] = bound;
      }
      const projection = projections.get(varName);
      if (projection !== undefined && !(varName in result)) {
        const mergedBinding = { ...binding, ...result };
        const value = resolver === undefined
          ? this.expressionEvaluator.evaluate(
            projection,
            mergedBinding,
            solutionContext,
          )
          : this.expressionEvaluator.evaluateWithAggregates(
            projection,
            mergedBinding,
            resolver,
            solutionContext,
          );
        if (value !== undefined) {
          result[varName] = value;
        }
      }
    }
    return result;
  }

  private async evaluateAsk(query: AskQuery): Promise<SparqlAskResults> {
    const bindings = await (await this.bgpEvaluatorFor(query.from))
      .evaluateBgp(query.where || []);
    return {
      head: { link: null },
      boolean: bindings.length > 0,
    };
  }

  private async evaluateConstruct(
    query: ConstructQuery,
  ): Promise<SparqlConstructResults> {
    const bindings = await (await this.bgpEvaluatorFor(query.from))
      .evaluateBgp(query.where || []);
    const quads: rdfjs.Quad[] = [];

    if (!query.template) {
      return { quads };
    }

    // Reified-triple templates (`<< s p o >>`, annotation `{| ... |}`)
    // expand into a reifier blank node joined to its `rdf:reifies` triple
    // term, so the template instantiates the RDF 1.2 reifier representation.
    const template = expandReifiedTriples(query.template);

    for (const binding of bindings) {
      // Blank nodes in a CONSTRUCT template are fresh per solution mapping
      // (SPARQL 1.1 §16.2.1): the parser expands RDF collections and _:b
      // template terms into shared labels, so remap them per binding.
      const bnodeMap = new Map<string, rdfjs.BlankNode>();
      for (const t of template) {
        const s = this.resolveConstructTerm(t.subject, binding, bnodeMap);
        const p = this.resolveConstructTerm(
          simplePredicate(t.predicate),
          binding,
          bnodeMap,
        );
        const o = this.resolveConstructTerm(t.object, binding, bnodeMap);

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
    solutions: SelectSolution[],
    order: NonNullable<SelectQuery["order"]>,
    context?: ExpressionEvaluationContext,
  ): SelectSolution[] {
    const comparators = order.map((clause) => ({
      descending: clause.descending === true,
      resolve: (solution: SelectSolution): rdfjs.Term | undefined => {
        const resolver = solution.group === null
          ? undefined
          : this.aggregateResolver(solution, context);
        return resolver === undefined
          ? this.expressionEvaluator.evaluate(
            clause.expression,
            solution.binding,
            context,
          )
          : this.expressionEvaluator.evaluateWithAggregates(
            clause.expression,
            solution.binding,
            resolver,
            context,
          );
      },
    }));
    return [...solutions].sort((a, b) => {
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
    bnodeMap: Map<string, rdfjs.BlankNode>,
  ): rdfjs.Term | null {
    if (term.termType === "Variable") {
      const bound = binding[term.value];
      if (bound) {
        return bound;
      }
      return null;
    }
    if (term.termType === "BlankNode") {
      const existing = bnodeMap.get(term.value);
      if (existing !== undefined) {
        return existing;
      }
      const fresh = DataFactory.blankNode(`c${this.nextConstructBnodeId++}`);
      bnodeMap.set(term.value, fresh);
      return fresh;
    }
    if (term.termType === "Quad") {
      // A triple term in a template resolves its three positions recursively,
      // so embedded variables and nested quoted triples instantiate per
      // solution.
      const s = this.resolveConstructTerm(term.subject, binding, bnodeMap);
      const p = this.resolveConstructTerm(term.predicate, binding, bnodeMap);
      const o = this.resolveConstructTerm(term.object, binding, bnodeMap);
      if (!s || !p || !o) {
        return null;
      }
      return DataFactory.quad(
        s as rdfjs.Quad_Subject,
        p as rdfjs.Quad_Predicate,
        o as rdfjs.Quad_Object,
      );
    }
    return sparqlTermToRdfTerm(term);
  }
}

/**
 * expressionContainsAggregate reports whether an expression tree contains an
 * aggregate node (COUNT, SUM, ...) anywhere inside it.
 */
function expressionContainsAggregate(
  expression: Expression | Pattern,
): boolean {
  if ("termType" in expression) {
    return false;
  }
  if (!("type" in expression)) {
    return false;
  }
  if (expression.type === "aggregate") {
    return true;
  }
  if (expression.type === "operation") {
    return expression.args.some(expressionContainsAggregate);
  }
  if (expression.type === "functionCall") {
    return expression.args.some(expressionContainsAggregate);
  }
  return false;
}

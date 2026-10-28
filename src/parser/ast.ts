import type { RdfBaseQuad, RdfNamedNode, RdfTerm } from "./rdf-terms.ts";

export type Term = RdfTerm;

export interface VariableTerm {
  termType: "Variable";
  value: string;
}

export interface Wildcard {
  termType: "Wildcard";
  value: "*";
}

/**
 * ReifiedQuad is an RDF/JS Quad produced by the parser from SPARQL
 * quoted-triple syntax. Two optional markers distinguish the RDF 1.2 forms:
 *
 * - `tripleTerm` marks data triple terms (`<<( s p o )>>`) — the evaluator
 *   treats them as data and never expands them into reifier statements.
 * - `reifier` carries the reifier binding of `<< s p o ~ r >>` so the
 *   evaluator binds it instead of minting a fresh internal reifier.
 */
export interface ReifiedQuad extends RdfBaseQuad {
  tripleTerm?: boolean;
  reifier?: Term;
}

export type PathElement = RdfNamedNode | PropertyPath;

export interface PropertyPath {
  type: "path";
  pathType: "|" | "/" | "^" | "+" | "*" | "?" | "!";
  items: PathElement[];
}

export interface Triple {
  subject: Term;
  predicate: Term | PropertyPath;
  object: Term;
}

export type Expression =
  | OperationExpression
  | ExistsExpression
  | MembershipExpression
  | FunctionCallExpression
  | AggregateExpression
  | Term;

export interface OperationExpression {
  type: "operation";
  operator: string;
  args: Expression[];
}

/**
 * ExistsExpression is `EXISTS { ... }` / `NOT EXISTS { ... }`: its single
 * argument is the group graph pattern, not an expression.
 */
export interface ExistsExpression {
  type: "operation";
  operator: "exists" | "notexists";
  args: Pattern[];
}

/**
 * MembershipExpression is `x IN (...)` / `x NOT IN (...)`: its arguments are
 * the tested expression and the list of candidate expressions.
 */
export interface MembershipExpression {
  type: "operation";
  operator: "in" | "notin";
  args: [Expression, Expression[]];
}

export interface FunctionCallExpression {
  type: "functionCall";
  function: string | Term;
  args: Expression[];
  /** distinct is set by the parser for `f(DISTINCT ...)` argument lists. */
  distinct?: boolean;
}

export interface AggregateExpression {
  type: "aggregate";
  aggregation: string;
  /** expression is the aggregated expression, or the wildcard for `COUNT(*)`. */
  expression: Expression | Wildcard;
  distinct: boolean;
  separator?: string;
}

export type ValuePatternRow = Record<string, Term | undefined>;

export type Pattern =
  | BgpPattern
  | FilterPattern
  | BindPattern
  | OptionalPattern
  | UnionPattern
  | GroupPattern
  | GraphPattern
  | MinusPattern
  | ServicePattern
  | ValuesPattern
  | QuadsPattern
  | SelectSubQuery;

export interface BgpPattern {
  type: "bgp";
  triples: Triple[];
}

export interface BindPattern {
  type: "bind";
  variable: VariableTerm;
  expression: Expression;
}

export interface QuadsPattern {
  type: "quads";
  name?: Term;
  triples?: Triple[];
  patterns?: Pattern[];
}

export type Quads = BgpPattern | GraphPattern | QuadsPattern;

export interface FilterPattern {
  type: "filter";
  expression: Expression;
}

export interface OptionalPattern {
  type: "optional";
  patterns: Pattern[];
}

export interface UnionPattern {
  type: "union";
  patterns: Pattern[];
}

export interface GroupPattern {
  type: "group";
  patterns: Pattern[];
}

export interface GraphPattern {
  type: "graph";
  name: Term;
  patterns: Pattern[];
  triples?: Triple[];
}

export interface MinusPattern {
  type: "minus";
  patterns: Pattern[];
}

export interface ServicePattern {
  type: "service";
  name: Term;
  patterns: Pattern[];
  silent: boolean;
}

export interface ValuesPattern {
  type: "values";
  values: ValuePatternRow[];
}

export type SelectSubQuery = SelectQuery;

export interface FromClause {
  default: Term[];
  named: Term[];
}

export interface Ordering {
  expression: Expression;
  descending?: boolean;
}

export interface Grouping {
  variable?: VariableTerm;
  expression: Expression;
}

export interface VariableExpression {
  variable: VariableTerm;
  expression: Expression;
}

/**
 * QueryModifiers are the solution modifiers (and trailing `VALUES`) every
 * query form accepts in the SPARQL grammar.
 */
export interface QueryModifiers {
  group?: Grouping[];
  having?: Expression[];
  order?: Ordering[];
  limit?: number;
  offset?: number;
  values?: ValuePatternRow[];
}

export interface SelectQuery {
  type: "query";
  queryType: "SELECT";
  prefixes?: Record<string, string>;
  base?: string;
  variables: Array<VariableTerm | Wildcard | VariableExpression>;
  where?: Pattern[];
  group?: Grouping[];
  having?: Expression[];
  order?: Ordering[];
  limit?: number;
  offset?: number;
  values?: ValuePatternRow[];
  distinct?: boolean;
  reduced?: boolean;
  from?: FromClause;
}

export interface AskQuery extends QueryModifiers {
  type: "query";
  queryType: "ASK";
  prefixes?: Record<string, string>;
  base?: string;
  where?: Pattern[];
  from?: FromClause;
}

export interface ConstructQuery extends QueryModifiers {
  type: "query";
  queryType: "CONSTRUCT";
  prefixes?: Record<string, string>;
  base?: string;
  template?: Triple[];
  where?: Pattern[];
  from?: FromClause;
}

export interface DescribeQuery extends QueryModifiers {
  type: "query";
  queryType: "DESCRIBE";
  prefixes?: Record<string, string>;
  base?: string;
  variables: Array<VariableTerm | Wildcard>;
  where?: Pattern[];
  from?: FromClause;
}

export type Query = SelectQuery | AskQuery | ConstructQuery | DescribeQuery;

export interface GraphOrDefault {
  type: "graph" | "default";
  name?: Term;
}

export interface GraphRefAll {
  type: "graph" | "default" | "named" | "all";
  name?: Term;
}

export interface InsertDeleteOperation {
  updateType:
    | "insert"
    | "delete"
    | "deletewhere"
    | "deleteinsert"
    | "insertdelete";
  type?: undefined;
  graph?: Term;
  insert?: Pattern[];
  delete?: Pattern[];
  where?: Pattern[];
  using?: FromClause;
}

export interface ClearDropOperation {
  type: "clear" | "drop";
  updateType?: undefined;
  silent?: boolean;
  graph: GraphRefAll;
}

export interface CreateOperation {
  type: "create";
  updateType?: undefined;
  silent?: boolean;
  graph: GraphOrDefault;
}

export interface CopyMoveOperation {
  type: "copy" | "move" | "add";
  updateType?: undefined;
  silent?: boolean;
  source: GraphOrDefault;
  destination: GraphOrDefault;
}

export interface LoadOperation {
  type: "load";
  updateType?: undefined;
  silent?: boolean;
  source: Term;
  destination?: Term;
}

export type UpdateOperation =
  | InsertDeleteOperation
  | ClearDropOperation
  | CreateOperation
  | CopyMoveOperation
  | LoadOperation;

export interface UpdateQuery {
  type: "update";
  prefixes?: Record<string, string>;
  /**
   * base is the effective base IRI the grammar recorded at parse time (the
   * query's BASE directive, or the parser's base option when there is no
   * directive). Update ASTs carry it like query ASTs.
   */
  base?: string;
  updates: UpdateOperation[];
}

export type SparqlQuery = Query | UpdateQuery;

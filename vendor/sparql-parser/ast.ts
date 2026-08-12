import type * as rdfjs from "@rdfjs/types";

export type Term = rdfjs.Term;

export interface VariableTerm {
  termType: "Variable";
  value: string;
}

export interface Wildcard {
  termType: "Wildcard";
  value: "*";
}

export type PathElement = rdfjs.NamedNode | PropertyPath;

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
  | FunctionCallExpression
  | AggregateExpression
  | Term;

export interface OperationExpression {
  type: "operation";
  operator: string;
  args: Expression[];
}

export interface FunctionCallExpression {
  type: "functionCall";
  function: string | Term;
  args: Expression[];
}

export interface AggregateExpression {
  type: "aggregate";
  aggregation: string;
  expression: Expression;
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

export interface AskQuery {
  type: "query";
  queryType: "ASK";
  prefixes?: Record<string, string>;
  base?: string;
  where?: Pattern[];
  from?: FromClause;
}

export interface ConstructQuery {
  type: "query";
  queryType: "CONSTRUCT";
  prefixes?: Record<string, string>;
  base?: string;
  template?: Triple[];
  where?: Pattern[];
  from?: FromClause;
}

export interface DescribeQuery {
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
  updates: UpdateOperation[];
}

export type SparqlQuery = Query | UpdateQuery;

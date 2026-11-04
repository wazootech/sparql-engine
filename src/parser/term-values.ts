import type {
  RdfBlankNode,
  RdfDefaultGraph,
  RdfNamedNode,
  RdfTerm,
  RdfVariable,
} from "./rdf-terms.ts";

/**
 * Plain-record RDF/JS terms for the SPARQL AST.
 *
 * The parser builds every term of the AST here instead of through the
 * `DataFactory` classes. The AST is a union of record shapes (`Expression`,
 * `Pattern`, ...), and the native compiler (scriptc, issue #221) cannot hold a
 * class instance in a union of records. A record that carries its own `equals`
 * is still a complete RDF/JS term (`termType`, `value`, `equals`, ...), which
 * is all the evaluator and consumers read; term equality is by value, as in
 * `DataFactory`.
 */

export const RDF_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
export const RDF_DIR_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
export const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function namedNodeEquals(
  this: RdfNamedNode,
  other: RdfTerm | null | undefined,
): boolean {
  return other !== null && other !== undefined &&
    other.termType === "NamedNode" &&
    other.value === this.value;
}

/** namedNodeTerm builds an IRI term. */
export function namedNodeTerm(value: string): RdfNamedNode {
  return {
    termType: "NamedNode",
    value,
    equals: namedNodeEquals,
  };
}

function blankNodeEquals(
  this: RdfBlankNode,
  other: RdfTerm | null | undefined,
): boolean {
  return other !== null && other !== undefined &&
    other.termType === "BlankNode" &&
    other.value === this.value;
}

/** blankNodeTerm builds a blank node term. */
export function blankNodeTerm(value: string): RdfBlankNode {
  return {
    termType: "BlankNode",
    value,
    equals: blankNodeEquals,
  };
}

function variableEquals(
  this: RdfVariable,
  other: RdfTerm | null | undefined,
): boolean {
  return other !== null && other !== undefined &&
    other.termType === "Variable" &&
    other.value === this.value;
}

/** variableTerm builds a query variable term. */
export function variableTerm(value: string): RdfVariable {
  return {
    termType: "Variable",
    value,
    equals: variableEquals,
  };
}

function defaultGraphEquals(
  this: RdfDefaultGraph,
  other: RdfTerm | null | undefined,
): boolean {
  return other !== null && other !== undefined &&
    other.termType === "DefaultGraph";
}

const DEFAULT_GRAPH: RdfDefaultGraph = {
  termType: "DefaultGraph",
  value: "",
  equals: defaultGraphEquals,
};

/** defaultGraphTerm returns the default graph term. */
export function defaultGraphTerm(): RdfDefaultGraph {
  return DEFAULT_GRAPH;
}

import type {
  RdfBaseQuad,
  RdfBlankNode,
  RdfDefaultGraph,
  RdfLiteral,
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

const RDF_LANG_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const RDF_DIR_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** namedNodeTerm builds an IRI term. */
export function namedNodeTerm(value: string): RdfNamedNode {
  return {
    termType: "NamedNode",
    value,
    equals: (other: RdfTerm | null | undefined): boolean =>
      other !== null && other !== undefined && other.termType === "NamedNode" &&
      other.value === value,
  };
}

/** blankNodeTerm builds a blank node term. */
export function blankNodeTerm(value: string): RdfBlankNode {
  return {
    termType: "BlankNode",
    value,
    equals: (other: RdfTerm | null | undefined): boolean =>
      other !== null && other !== undefined && other.termType === "BlankNode" &&
      other.value === value,
  };
}

/** variableTerm builds a query variable term. */
export function variableTerm(value: string): RdfVariable {
  return {
    termType: "Variable",
    value,
    equals: (other: RdfTerm | null | undefined): boolean =>
      other !== null && other !== undefined && other.termType === "Variable" &&
      other.value === value,
  };
}

const DEFAULT_GRAPH: RdfDefaultGraph = {
  termType: "DefaultGraph",
  value: "",
  equals: (other: RdfTerm | null | undefined): boolean =>
    other !== null && other !== undefined && other.termType === "DefaultGraph",
};

/** defaultGraphTerm returns the default graph term. */
export function defaultGraphTerm(): RdfDefaultGraph {
  return DEFAULT_GRAPH;
}

function literalOf(
  value: string,
  language: string,
  direction: "ltr" | "rtl" | "",
  datatype: RdfNamedNode,
): RdfLiteral {
  return {
    termType: "Literal",
    value,
    language,
    direction,
    datatype,
    equals: (other: RdfTerm | null | undefined): boolean => {
      if (
        other === null || other === undefined || other.termType !== "Literal"
      ) {
        return false;
      }
      return value === other.value && language === other.language &&
        direction === (other.direction ?? "") &&
        datatype.value === other.datatype.value;
    },
  };
}

/** literalTerm builds a literal with a datatype (xsd:string by default). */
export function literalTerm(
  value: string,
  datatype?: RdfNamedNode,
): RdfLiteral {
  return literalOf(
    value,
    "",
    "",
    datatype === undefined ? namedNodeTerm(XSD_STRING) : datatype,
  );
}

/**
 * languageLiteralTerm builds a language-tagged literal; a direction makes it
 * an rdf:dirLangString literal (RDF 1.2).
 */
export function languageLiteralTerm(
  value: string,
  language: string,
  direction: "ltr" | "rtl" | "",
): RdfLiteral {
  return literalOf(
    value,
    language.toLowerCase(),
    direction,
    namedNodeTerm(direction ? RDF_DIR_LANG_STRING : RDF_LANG_STRING),
  );
}

/** QuadTermValue is a quad term that may carry the SPARQL 1.2 markers. */
export interface QuadTermValue extends RdfBaseQuad {
  tripleTerm?: boolean;
  reifier?: RdfTerm;
}

/** quadTerm builds a quad in the default graph. */
export function quadTerm(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
): QuadTermValue {
  const graph = DEFAULT_GRAPH;
  return {
    termType: "Quad",
    value: "",
    subject,
    predicate,
    object,
    graph,
    equals: (other: RdfTerm | null | undefined): boolean => {
      if (other === null || other === undefined || other.termType !== "Quad") {
        return false;
      }
      return subject.equals(other.subject) &&
        predicate.equals(other.predicate) &&
        object.equals(other.object) && graph.equals(other.graph);
    },
  };
}

import type {
  RdfBaseQuad,
  RdfBlankNode,
  RdfDefaultGraph,
  RdfDirectionalLanguage,
  RdfLiteral,
  RdfNamedNode,
  RdfQuad,
  RdfQuadGraph,
  RdfQuadObject,
  RdfQuadPredicate,
  RdfQuadSubject,
  RdfTerm,
  RdfVariable,
} from "@/parser/rdf-terms.ts";
import {
  blankNodeTerm,
  defaultGraphTerm,
  languageLiteralTerm,
  literalTerm,
  namedNodeTerm,
  quadEquals,
  variableTerm,
} from "@/parser/term-values.ts";

let blankNodeCounter = 0;

export const RDF_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
export const RDF_DIR_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
export const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/**
 * The factory builds plain-record terms (see `term-values.ts`), not class
 * instances. The native compiler (scriptc, issue #221) identifies records
 * structurally, so a class instance flowing into an `RdfTerm`-typed slot would
 * share a union with same-shaped records and could not be laid out. One
 * representation, records, keeps every term value in a single layout. The
 * terms are RDF/JS terms: they carry `termType`, `value` and `equals`.
 */

/** LocalDataFactory is the term factory over the engine's local term types. */
export interface LocalDataFactory {
  namedNode(value: string): RdfNamedNode;
  blankNode(value?: string): RdfBlankNode;
  literal(
    value: string,
    languageOrDatatype?: string | RdfNamedNode | RdfDirectionalLanguage,
  ): RdfLiteral;
  variable(value: string): RdfVariable;
  defaultGraph(): RdfDefaultGraph;
  quad(
    subject: RdfTerm,
    predicate: RdfTerm,
    object: RdfTerm,
    graph?: RdfTerm,
  ): RdfQuad;
  fromTerm(original: RdfTerm): RdfTerm;
  fromQuad(original: RdfQuad): RdfQuad;
}

/** defaultGraphInstance is the shared default graph term. */
export const defaultGraphInstance: RdfDefaultGraph = defaultGraphTerm();

function newNamedNode(value: string): RdfNamedNode {
  return namedNodeTerm(value);
}

function newBlankNode(value?: string): RdfBlankNode {
  if (value === undefined) {
    blankNodeCounter += 1;
    return blankNodeTerm(`b${blankNodeCounter}`);
  }
  return blankNodeTerm(value);
}

function newLiteral(
  value: string,
  languageOrDatatype?: string | RdfNamedNode | RdfDirectionalLanguage,
): RdfLiteral {
  if (typeof languageOrDatatype === "string") {
    return languageLiteralTerm(value, languageOrDatatype, "");
  }
  if (languageOrDatatype === undefined) {
    return literalTerm(value);
  }
  if ("termType" in languageOrDatatype) {
    return literalTerm(value, languageOrDatatype);
  }
  // A DirectionalLanguage: a language tag with an optional RDF 1.2 initial
  // text direction. A direction makes this an rdf:dirLangString literal.
  const direction = languageOrDatatype.direction;
  return languageLiteralTerm(
    value,
    languageOrDatatype.language,
    direction === "ltr" || direction === "rtl" ? direction : "",
  );
}

function newQuad(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
  graph?: RdfTerm,
): RdfQuad {
  const graphTerm: RdfTerm = graph === undefined ? defaultGraphInstance : graph;
  return {
    termType: "Quad",
    value: "",
    subject: subject as RdfQuadSubject,
    predicate: predicate as RdfQuadPredicate,
    object: object as RdfQuadObject,
    graph: graphTerm as RdfQuadGraph,
    equals: quadEquals,
  };
}

function newFromTerm(original: RdfTerm): RdfTerm {
  switch (original.termType) {
    case "NamedNode":
      return newNamedNode(original.value);
    case "BlankNode":
      return newBlankNode(original.value);
    case "Literal":
      return newLiteral(
        original.value,
        original.language
          ? { language: original.language, direction: original.direction }
          : original.datatype,
      );
    case "Variable":
      return variableTerm(original.value);
    case "DefaultGraph":
      return defaultGraphInstance;
    case "Quad": {
      const quad: RdfBaseQuad = original;
      return newQuad(quad.subject, quad.predicate, quad.object, quad.graph);
    }
  }
}

function newFromQuad(original: RdfQuad): RdfQuad {
  return newQuad(
    original.subject,
    original.predicate,
    original.object,
    original.graph,
  );
}

export const DataFactory: LocalDataFactory = {
  namedNode: newNamedNode,
  blankNode: newBlankNode,
  literal: newLiteral,
  variable: variableTerm,
  defaultGraph: defaultGraphTerm,
  quad: newQuad,
  fromTerm: newFromTerm,
  fromQuad: newFromQuad,
};

export const dataFactory = DataFactory;

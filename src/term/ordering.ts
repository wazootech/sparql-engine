import type * as rdfjs from "@rdfjs/types";
import { termKey } from "./identity.ts";
import {
  compareNumericValues,
  NUMERIC_DATATYPES,
  numericValue,
  XSD_STRING,
} from "./numeric.ts";

/**
 * compareStrings orders two strings by codepoint comparison.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * literalDatatype returns the effective datatype of a literal for ordering:
 * plain literals are treated as xsd:string, matching SPARQL 1.1 result
 * semantics and the reference engines.
 */
function literalDatatype(literal: rdfjs.Literal): string {
  return literal.datatype?.value ?? XSD_STRING;
}

/**
 * compareLiterals orders two literals: first by datatype IRI (plain literals
 * counting as xsd:string), then numerically for literals of the same numeric
 * datatype, then by codepoint comparison of the lexical forms. This matches
 * the SPARQL 1.1 §12.4 ordering rules as implemented by the reference
 * engines, including the lang-tagged (rdf:langString) case.
 */
function compareLiterals(a: rdfjs.Literal, b: rdfjs.Literal): number {
  const da = literalDatatype(a);
  const db = literalDatatype(b);
  if (da !== db) {
    return compareStrings(da, db);
  }
  if (NUMERIC_DATATYPES.has(da)) {
    const an = numericValue(a);
    const bn = numericValue(b);
    if (an !== null && bn !== null) {
      const numeric = compareNumericValues(an, bn);
      if (numeric !== 0) {
        return numeric;
      }
    }
  }
  return compareStrings(a.value, b.value);
}

/**
 * compareRdfTerms orders two RDF terms (or undefined for an unbound
 * variable) per SPARQL 1.1 §12.4: unbound sorts lowest, then blank nodes,
 * then IRIs, then literals. Literals order by datatype IRI first (plain
 * literals counting as xsd:string), numerically within the same numeric
 * datatype, then by lexical form. Blank-node labels and the relative order
 * of terms the spec leaves undefined (mixed blank nodes, RDF-star quads)
 * are compared deterministically. Returns a negative, zero, or positive
 * number suitable for Array.prototype.sort.
 */
export function compareRdfTerms(
  a: rdfjs.Term | undefined,
  b: rdfjs.Term | undefined,
): number {
  if (a === undefined) {
    return b === undefined ? 0 : -1;
  }
  if (b === undefined) {
    return 1;
  }
  const rank = (term: rdfjs.Term): number => {
    switch (term.termType) {
      case "BlankNode":
        return 0;
      case "NamedNode":
        return 1;
      case "Literal":
        return 2;
      default:
        // Quad (RDF-star) and other extension terms: implementation-defined.
        return 3;
    }
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) {
    return ra - rb;
  }
  switch (a.termType) {
    case "BlankNode":
      return compareStrings(a.value, (b as rdfjs.BlankNode).value);
    case "NamedNode":
      return compareStrings(a.value, (b as rdfjs.NamedNode).value);
    case "Literal":
      return compareLiterals(a as rdfjs.Literal, b as rdfjs.Literal);
    default:
      return compareStrings(termKey(a), termKey(b));
  }
}

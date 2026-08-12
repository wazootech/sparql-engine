import type * as rdfjs from "@rdfjs/types";
import type { SparqlValue } from "@/sparql-engine-interface.ts";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/**
 * CanonicalTerm is a serialization-stable projection of an RDF term that is
 * produced identically from Comunica terms, native SparqlValue objects, and
 * other RDF/JS-shaped terms such as Oxigraph's. Two terms canonicalize to the
 * same CanonicalTerm exactly when they are the same RDF term.
 */
export type CanonicalTerm = {
  termType: "NamedNode" | "BlankNode" | "Literal" | "DefaultGraph" | "Quad";
  value: string;
  language?: string;
  datatype?: string;
  subject?: CanonicalTerm;
  predicate?: CanonicalTerm;
  object?: CanonicalTerm;
};

/**
 * canonicalizeRdfTerm normalizes an RDF/JS-shaped term into a CanonicalTerm.
 * Plain xsd:string literals drop their datatype (it is implicit), and
 * RDF-star triple terms flatten to subject/predicate/object.
 */
export function canonicalizeRdfTerm(term: rdfjs.Term): CanonicalTerm {
  switch (term.termType) {
    case "NamedNode":
      return { termType: "NamedNode", value: term.value };
    case "BlankNode":
      return { termType: "BlankNode", value: term.value };
    case "DefaultGraph":
      return { termType: "DefaultGraph", value: term.value };
    case "Literal": {
      const canonical: CanonicalTerm = {
        termType: "Literal",
        value: term.value,
      };
      if (term.language) {
        canonical.language = term.language;
      } else if (term.datatype && term.datatype.value !== XSD_STRING) {
        canonical.datatype = term.datatype.value;
      }
      return canonical;
    }
    case "Quad":
      return {
        termType: "Quad",
        value: "",
        subject: canonicalizeRdfTerm(term.subject),
        predicate: canonicalizeRdfTerm(term.predicate),
        object: canonicalizeRdfTerm(term.object),
      };
    default:
      throw new Error(`Unsupported RDF term type: ${term.termType}`);
  }
}

/**
 * canonicalizeSparqlValue normalizes a native SparqlValue into a
 * CanonicalTerm, so native results compare structurally with RDF/JS-shaped
 * results from other engines.
 */
export function canonicalizeSparqlValue(value: SparqlValue): CanonicalTerm {
  switch (value.type) {
    case "uri":
      return { termType: "NamedNode", value: value.value };
    case "bnode":
      return { termType: "BlankNode", value: value.value };
    case "literal": {
      const canonical: CanonicalTerm = {
        termType: "Literal",
        value: value.value,
      };
      if (value["xml:lang"]) {
        canonical.language = value["xml:lang"];
      } else if (value.datatype && value.datatype !== XSD_STRING) {
        canonical.datatype = value.datatype;
      }
      return canonical;
    }
    case "triple":
      return {
        termType: "Quad",
        value: "",
        subject: canonicalizeSparqlValue(value.value.subject),
        predicate: canonicalizeSparqlValue(value.value.predicate),
        object: canonicalizeSparqlValue(value.value.object),
      };
  }
}

import type * as rdfjs from "@rdfjs/types";
import type { Term as SparqlTerm } from "sparqljs";
import type { SparqlValue } from "@/sparql-engine-interface.ts";
import { DataFactory } from "n3";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

/**
 * sparqlTermToRdfTerm converts a sparqljs AST term to an RDF/JS term.
 */
export function sparqlTermToRdfTerm(term: SparqlTerm): rdfjs.Term {
  switch (term.termType) {
    case "NamedNode":
      return namedNode(term.value);
    case "BlankNode":
      return blankNode(term.value);
    case "Literal":
      if (term.language) {
        return literal(term.value, term.language);
      }
      if (term.datatype) {
        return literal(term.value, namedNode(term.datatype.value));
      }
      return literal(term.value);
    default:
      throw new Error(`Unsupported term type: ${term.termType}`);
  }
}

/**
 * sparqlValueToRdfTerm converts a SparqlValue (the engine's result wire
 * format) back to an RDF/JS term, e.g. for CONSTRUCT templates and update
 * templates.
 */
export function sparqlValueToRdfTerm(val: SparqlValue): rdfjs.Term {
  switch (val.type) {
    case "uri":
      return namedNode(val.value);
    case "bnode":
      return blankNode(val.value);
    case "literal":
      if (val["xml:lang"]) {
        return literal(val.value, val["xml:lang"]);
      }
      if (val.datatype) {
        return literal(val.value, namedNode(val.datatype));
      }
      return literal(val.value);
    case "triple":
      return quad(
        sparqlValueToRdfTerm(val.value.subject) as rdfjs.Quad_Subject,
        sparqlValueToRdfTerm(val.value.predicate) as rdfjs.Quad_Predicate,
        sparqlValueToRdfTerm(val.value.object) as rdfjs.Quad_Object,
        defaultGraph(),
      );
  }
}

/**
 * rdfTermToSparqlValue converts an RDF/JS term to a SparqlValue, the engine's
 * result wire format. Plain string literals carry no datatype (xsd:string is
 * implicit in SPARQL results); lang-tagged and typed literals carry their
 * language or datatype.
 */
export function rdfTermToSparqlValue(term: rdfjs.Term): SparqlValue {
  switch (term.termType) {
    case "NamedNode":
      return { type: "uri", value: term.value };
    case "BlankNode":
      return { type: "bnode", value: term.value };
    case "Literal": {
      const result: SparqlValue = { type: "literal", value: term.value };
      if (term.language) {
        result["xml:lang"] = term.language;
      } else if (
        term.datatype &&
        term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
      ) {
        result.datatype = term.datatype.value;
      }
      return result;
    }
    case "Quad":
      return {
        type: "triple",
        value: {
          subject: rdfTermToSparqlValue(term.subject),
          predicate: rdfTermToSparqlValue(term.predicate),
          object: rdfTermToSparqlValue(term.object),
        },
      };
    default:
      throw new Error(`Unsupported RDF term type: ${term.termType}`);
  }
}

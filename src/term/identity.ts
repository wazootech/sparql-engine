import type * as rdfjs from "@rdfjs/types";
import type { SparqlValue } from "@/sparql-engine-interface.ts";

/**
 * termKey renders a deterministic key for an RDF/JS term, normalizing its
 * type, value, and — for literals — language and datatype, with RDF-star
 * nesting handled recursively. Two terms produce the same key exactly when
 * they are the same RDF term, so termKey is a sound hash-index key.
 */
export function termKey(term: rdfjs.Term): string {
  switch (term.termType) {
    case "NamedNode":
      return `uri:${term.value}`;
    case "BlankNode":
      return `bnode:${term.value}`;
    case "Variable":
      return `var:${term.value}`;
    case "DefaultGraph":
      return "default";
    case "Literal":
      return (
        `literal:${term.value}|${term.language ?? ""}|` +
        `${term.datatype?.value ?? ""}`
      );
    case "Quad":
      return (
        `quad:${termKey(term.subject)}|${termKey(term.predicate)}|` +
        termKey(term.object)
      );
    default:
      throw new Error(
        `Unsupported RDF term type: ${(term as rdfjs.Term).termType}`,
      );
  }
}

/**
 * sameRdfTerm compares two RDF/JS terms by type, value, and literal
 * language/datatype. RDF-star triple terms are compared structurally on
 * subject, predicate, and object — the graph is a property of the statement,
 * not of the triple term, so it is not part of term identity.
 */
export function sameRdfTerm(a: rdfjs.Term, b: rdfjs.Term): boolean {
  if (a.termType !== b.termType) {
    return false;
  }
  switch (a.termType) {
    case "NamedNode":
      return a.value === (b as rdfjs.NamedNode).value;
    case "BlankNode":
      return a.value === (b as rdfjs.BlankNode).value;
    case "Variable":
      return a.value === (b as rdfjs.Variable).value;
    case "DefaultGraph":
      return true;
    case "Literal":
      return a.value === (b as rdfjs.Literal).value &&
        a.language === (b as rdfjs.Literal).language &&
        (a.datatype?.value ?? "") ===
          ((b as rdfjs.Literal).datatype?.value ?? "");
    case "Quad":
      return sameRdfTerm(a.subject, (b as rdfjs.Quad).subject) &&
        sameRdfTerm(a.predicate, (b as rdfjs.Quad).predicate) &&
        sameRdfTerm(a.object, (b as rdfjs.Quad).object);
    default:
      throw new Error(
        `Unsupported RDF term type: ${(a as rdfjs.Term).termType}`,
      );
  }
}

/**
 * sparqlValueKey renders a deterministic key for a SparqlValue, mirroring
 * termKey's literal normalization so two values produce the same key exactly
 * when sameSparqlValue says they are equal.
 */
export function sparqlValueKey(value: SparqlValue): string {
  switch (value.type) {
    case "uri":
      return `uri:${value.value}`;
    case "bnode":
      return `bnode:${value.value}`;
    case "literal":
      return (
        `literal:${value.value}|${value["xml:lang"] ?? ""}|` +
        `${value.datatype ?? ""}`
      );
    case "triple":
      return (
        `quad:${sparqlValueKey(value.value.subject)}|${
          sparqlValueKey(value.value.predicate)
        }|` +
        sparqlValueKey(value.value.object)
      );
  }
}

/**
 * sameSparqlValue compares two SparqlValues structurally: by type, value,
 * and — for literals — language and datatype, with triple values compared
 * recursively. Two values are equal exactly when their sparqlValueKey
 * strings match.
 */
export function sameSparqlValue(a: SparqlValue, b: SparqlValue): boolean {
  switch (a.type) {
    case "uri":
      return b.type === "uri" && a.value === b.value;
    case "bnode":
      return b.type === "bnode" && a.value === b.value;
    case "literal":
      return b.type === "literal" &&
        a.value === b.value &&
        (a["xml:lang"] ?? "") === (b["xml:lang"] ?? "") &&
        (a.datatype ?? "") === (b.datatype ?? "");
    case "triple":
      return b.type === "triple" &&
        sameSparqlValue(a.value.subject, b.value.subject) &&
        sameSparqlValue(a.value.predicate, b.value.predicate) &&
        sameSparqlValue(a.value.object, b.value.object);
  }
}

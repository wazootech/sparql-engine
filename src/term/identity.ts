import type {
  RdfBlankNode,
  RdfLiteral,
  RdfNamedNode,
  RdfQuad,
  RdfTerm,
  RdfVariable,
} from "@/parser/rdf-terms.ts";

/**
 * termKey renders a deterministic key for an RDF/JS term, normalizing its
 * type, value, and — for literals — language and datatype, with RDF-star
 * nesting handled recursively. Two terms produce the same key exactly when
 * they are the same RDF term, so termKey is a sound hash-index key.
 */
/**
 * escapeTermValue escapes the characters reserved by the termKey
 * serialization (the `|` field separators and the \` escape marker) so
 * that distinct term values can never render the same key. Backslash is
 * escaped first so escape sequences themselves stay unambiguous.
 */
function escapeTermValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

export function termKey(term: RdfTerm): string {
  switch (term.termType) {
    case "NamedNode":
      return `uri:${escapeTermValue(term.value)}`;
    case "BlankNode":
      return `bnode:${escapeTermValue(term.value)}`;
    case "Variable":
      return `var:${escapeTermValue(term.value)}`;
    case "DefaultGraph":
      return "default";
    case "Literal":
      return (
        `literal:${escapeTermValue(term.value)}|` +
        `${escapeTermValue(term.language ?? "")}|` +
        `${escapeTermValue(term.direction ?? "")}|` +
        `${escapeTermValue(term.datatype?.value ?? "")}`
      );
    case "Quad":
      return (
        `quad:${termKey(term.subject)}|${termKey(term.predicate)}|` +
        termKey(term.object)
      );
    default:
      throw new Error(
        `Unsupported RDF term type: ${
          (term as Record<string, string>)["termType"]
        }`,
      );
  }
}

/**
 * sameRdfTerm compares two RDF/JS terms by type, value, and literal
 * language/datatype. RDF-star triple terms are compared structurally on
 * subject, predicate, and object — the graph is a property of the statement,
 * not of the triple term, so it is not part of term identity.
 */
export function sameRdfTerm(a: RdfTerm, b: RdfTerm): boolean {
  if (a.termType !== b.termType) {
    return false;
  }
  switch (a.termType) {
    case "NamedNode":
      return a.value === (b as RdfNamedNode).value;
    case "BlankNode":
      return a.value === (b as RdfBlankNode).value;
    case "Variable":
      return a.value === (b as RdfVariable).value;
    case "DefaultGraph":
      return true;
    case "Literal": {
      const other = b as RdfLiteral;
      return a.value === other.value &&
        a.language === other.language &&
        (a.direction ?? "") === (other.direction ?? "") &&
        (a.datatype?.value ?? "") === (other.datatype?.value ?? "");
    }
    case "Quad": {
      const other = b as RdfQuad;
      return sameRdfTerm(a.subject, other.subject) &&
        sameRdfTerm(a.predicate, other.predicate) &&
        sameRdfTerm(a.object, other.object);
    }
    default:
      throw new Error(
        `Unsupported RDF term type: ${
          (a as Record<string, string>)["termType"]
        }`,
      );
  }
}

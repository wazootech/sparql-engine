import type * as rdfjs from "@rdfjs/types";
import {
  escapeBlankNodeLabel,
  escapeIri,
  escapeLiteral,
} from "@/serialize/turtle-escape.ts";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

/** term serializes a single RDF/JS term (Turtle term grammar). */
export function term(
  t: rdfjs.Term,
  prefixes: Record<string, string> = {},
): string {
  switch (t.termType) {
    case "NamedNode":
      return iriTerm(t.value, prefixes);
    case "BlankNode":
      return `_:${escapeBlankNodeLabel(t.value)}`;
    case "Literal":
      return literalTerm(t, prefixes);
    case "Quad":
      return `<<( ${term(t.subject, prefixes)} ${term(t.predicate, prefixes)} ${
        term(t.object, prefixes)
      } )>>`;
    default:
      throw new Error(
        `Cannot serialize ${t.termType} term in Turtle: ${t.value}`,
      );
  }
}

/** iriTerm renders an IRI as a prefixed name when a registered namespace matches. */
function iriTerm(
  value: string,
  prefixes: Record<string, string>,
): string {
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (
      prefix.length > 0 && namespace.length > 0 && value.startsWith(namespace)
    ) {
      const local = value.slice(namespace.length);
      // Only use the compact form when the local name is a plain PN_LOCAL,
      // so the output always re-parses to the same IRI.
      if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(local)) {
        return `${prefix}:${local}`;
      }
    }
  }
  return `<${escapeIri(value)}>`;
}

/** literalTerm renders a literal with language/direction or datatype suffix. */
function literalTerm(
  term: rdfjs.Literal,
  prefixes: Record<string, string>,
): string {
  const value = `"${escapeLiteral(term.value)}"`;
  if (term.language) {
    const direction = term.direction ? `--${term.direction}` : "";
    return `${value}@${term.language}${direction}`;
  }
  if (
    term.datatype.value !== XSD_STRING &&
    term.datatype.value !== RDF_LANG_STRING
  ) {
    return `${value}^^${iriTerm(term.datatype.value, prefixes)}`;
  }
  return value;
}

import type * as rdfjs from "@rdfjs/types";
import type {
  PropertyPath,
  Term as SparqlTerm,
} from "@/parser/sparql-parser.ts";

/**
 * PathPair is one (subject, object) connection produced by a property path.
 */
export interface PathPair {
  subject: rdfjs.Term;
  object: rdfjs.Term;
}

/**
 * PathEntry is a property-path triple pattern with its resolved terms and
 * pre-computed connection pairs.
 */
export interface PathEntry {
  subject: SparqlTerm;
  object: SparqlTerm;
  pairs: PathPair[];
}

/**
 * PathElement is either a plain predicate IRI or a nested property path.
 */
export type PathElement = rdfjs.NamedNode | PropertyPath;

/**
 * isPropertyPath reports whether a triple predicate is a property path
 * rather than a simple predicate term.
 */
export function isPropertyPath(
  predicate: unknown,
): predicate is PropertyPath {
  return (
    typeof predicate === "object" &&
    predicate !== null &&
    (predicate as { type?: string }).type === "path"
  );
}

/**
 * isMultisetPath reports whether a property-path element can connect the same
 * (subject, object) pair through more than one route. Terms are always
 * multiset; the composition operators ^, /, and | inherit multiset semantics
 * from their parts, while the remaining operators yield a set of pairs.
 */
export function isMultisetPath(path: PathElement): boolean {
  if ("termType" in path) {
    return true;
  }
  if (
    path.pathType === "^" || path.pathType === "/" || path.pathType === "|"
  ) {
    return path.items.every((item) => isMultisetPath(item as PathElement));
  }
  return false;
}

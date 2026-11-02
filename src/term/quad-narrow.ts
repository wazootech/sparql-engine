import type {
  RdfBaseQuad,
  RdfQuad,
  RdfQuadGraph,
  RdfQuadObject,
  RdfQuadPredicate,
  RdfQuadSubject,
  RdfTerm,
} from "@/parser/rdf-terms.ts";
import { termKey } from "./identity.ts";

/**
 * narrowNestedQuad validates a base quad's components and returns a strict RdfQuad.
 */
function narrowNestedQuad(term: RdfBaseQuad): RdfQuad | undefined {
  const subject = narrowQuadSubject(term.subject);
  const predicate = narrowQuadPredicate(term.predicate);
  const object = narrowQuadObject(term.object);
  const graph = narrowQuadGraph(term.graph);
  if (
    subject === undefined || predicate === undefined || object === undefined ||
    graph === undefined
  ) {
    return undefined;
  }
  return {
    termType: "Quad",
    value: "",
    subject,
    predicate,
    object,
    graph,
    equals: term.equals,
  };
}

/**
 * narrowQuadSubject narrows an RDF term to a valid quad subject position.
 */
export function narrowQuadSubject(term: RdfTerm): RdfQuadSubject | undefined {
  if (term.termType === "NamedNode") {
    return term;
  }
  if (term.termType === "BlankNode") {
    return term;
  }
  if (term.termType === "Variable") {
    return term;
  }
  if (term.termType === "Quad") {
    return narrowNestedQuad(term);
  }
  return undefined;
}

/** narrowQuadPredicate narrows an RDF term to a valid quad predicate position. */
export function narrowQuadPredicate(
  term: RdfTerm,
): RdfQuadPredicate | undefined {
  if (term.termType === "NamedNode") {
    return term;
  }
  if (term.termType === "Variable") {
    return term;
  }
  return undefined;
}

/** narrowQuadObject narrows an RDF term to a valid quad object position. */
export function narrowQuadObject(term: RdfTerm): RdfQuadObject | undefined {
  if (term.termType === "NamedNode") {
    return term;
  }
  if (term.termType === "BlankNode") {
    return term;
  }
  if (term.termType === "Literal") {
    return term;
  }
  if (term.termType === "Variable") {
    return term;
  }
  if (term.termType === "Quad") {
    return narrowNestedQuad(term);
  }
  return undefined;
}

/** narrowQuadGraph narrows an RDF term to a valid quad graph position. */
export function narrowQuadGraph(term: RdfTerm): RdfQuadGraph | undefined {
  if (term.termType === "DefaultGraph") {
    return term;
  }
  if (term.termType === "NamedNode") {
    return term;
  }
  if (term.termType === "BlankNode") {
    return term;
  }
  if (term.termType === "Variable") {
    return term;
  }
  return undefined;
}

/** requireQuadGraph narrows a term to a graph position or throws. */
export function requireQuadGraph(term: RdfTerm): RdfQuadGraph {
  const graph = narrowQuadGraph(term);
  if (graph === undefined) {
    throw new Error("Invalid graph term for quad graph position");
  }
  return graph;
}

/** quadDedupKey is a stable key for deduplicating quads in dataset construction. */
export function quadDedupKey(quad: RdfQuad): string {
  return `${termKey(quad.subject)}\u0000${termKey(quad.predicate)}\u0000` +
    `${termKey(quad.object)}\u0000${termKey(quad.graph)}`;
}

import type * as rdfjs from "@rdfjs/types";
import type { ScanEntry, TermBinding } from "@/evaluator/join-bindings.ts";
import type { Term as SparqlTerm, Triple } from "@/parser/sparql-parser.ts";
import { isReifiesPattern } from "@/evaluator/reified.ts";
import { matchQuads, simplePredicate } from "@/quad-store.ts";
import { sameRdfTerm, sparqlTermToRdfTerm } from "@/term/mod.ts";

/**
 * scanEntry resolves a triple pattern and pre-fetches the candidate quads
 * matching its constant positions.
 */
export function scanEntry(
  store: rdfjs.Source<rdfjs.Quad>,
  pattern: Triple,
): Promise<ScanEntry> {
  const subject = pattern.subject;
  const predicate = simplePredicate(pattern.predicate);
  const object = pattern.object;
  const reifies = isReifiesPattern(predicate, object);
  // A triple-term object (`?s ?p <<( ?st ?pt ?ot )>>`) cannot be probed
  // positionally — its nested variables match structurally — so every quad
  // with a triple-term object in the subject/predicate scope is a candidate.
  const tripleTermObject = !reifies && object.termType === "Quad";
  // Reifies patterns scan every `rdf:reifies` statement; the join decomposes
  // each candidate's quoted triple term. Everything else matches positionally.
  const candidates = reifies
    ? matchQuads(store, null, predicate, null)
    : tripleTermObject
    ? matchQuads(
      store,
      patternConstant(subject),
      patternConstant(predicate),
      null,
    ).then((quads) => quads.filter((quad) => quad.object.termType === "Quad"))
    : matchQuads(
      store,
      patternConstant(subject),
      patternConstant(predicate),
      patternConstant(object),
    );
  return candidates.then((cs) => ({
    subject,
    predicate,
    object,
    candidates: cs,
    reifies,
    tripleTermObject,
  }));
}

export function isQueryVar(term: SparqlTerm): boolean {
  return term.termType === "Variable" || term.termType === "BlankNode";
}

export function getQueryVarName(term: SparqlTerm): string {
  if (term.termType === "BlankNode") {
    return `_:${term.value}`;
  }
  return term.value;
}

/**
 * matchPatternTerm matches a pattern position against a data term, extending
 * the binding: a variable position binds (or must agree with an existing
 * binding), a constant position must be the same RDF term, and a quad
 * position (a nested triple term / triple-term pattern) recurses into its
 * subject, predicate, and object — so `<<( ?s ?p <<( ?a ?b ?c )>> )>>`
 * binds variables at every nesting level.
 */
export function matchPatternTerm(
  term: SparqlTerm,
  value: rdfjs.Term,
  binding: TermBinding,
): TermBinding | null {
  if (isQueryVar(term)) {
    const name = getQueryVarName(term);
    const existing = binding[name];
    if (existing !== undefined) {
      return sameRdfTerm(existing, value) ? binding : null;
    }
    return { ...binding, [name]: value };
  }
  if (term.termType === "Quad") {
    if (value.termType !== "Quad") {
      return null;
    }
    const pattern = term as rdfjs.Quad;
    const data = value as rdfjs.Quad;
    let extended = matchPatternTerm(pattern.subject, data.subject, binding);
    if (extended === null) {
      return null;
    }
    extended = matchPatternTerm(pattern.predicate, data.predicate, extended);
    if (extended === null) {
      return null;
    }
    return matchPatternTerm(pattern.object, data.object, extended);
  }
  return sameRdfTerm(sparqlTermToRdfTerm(term), value) ? binding : null;
}

/**
 * patternConstant returns the RDF/JS term for a constant pattern position, or
 * null when the position is a variable that must not constrain the scan.
 */
function patternConstant(term: SparqlTerm): rdfjs.Term | null {
  if (isQueryVar(term)) {
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

/**
 * resolveTerm resolves a pattern position against a solution binding: bound
 * variables return their term, unbound variables and constants return the
 * term itself (constants via conversion).
 */
export function resolveTerm(
  term: SparqlTerm,
  binding: TermBinding,
): rdfjs.Term | null {
  if (isQueryVar(term)) {
    const bound = binding[getQueryVarName(term)];
    if (bound) {
      return bound;
    }
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

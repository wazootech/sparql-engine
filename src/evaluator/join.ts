import type * as rdfjs from "@rdfjs/types";
import type { Term as SparqlTerm, Triple } from "sparqljs";
import {
  buildQuadIndex,
  matchQuads,
  probeQuadIndex,
  simplePredicate,
} from "@/quad-store.ts";
import { sameRdfTerm, sparqlTermToRdfTerm } from "@/term/mod.ts";

/**
 * TermBinding maps variable names to the RDF/JS terms they resolve to during
 * evaluation. Bindings stay in term space internally; they are converted to
 * the SparqlValue wire format exactly once, at the response boundary.
 */
export type TermBinding = Record<string, rdfjs.Term>;

/**
 * ScanEntry is a triple pattern with its resolved terms and pre-fetched
 * candidate quads, so join ordering can use true store cardinalities without
 * issuing extra scans.
 */
export type ScanEntry = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
  candidates: rdfjs.Quad[];
};

/**
 * BindingFilter decides whether an extended binding survives an OPTIONAL
 * join; it is supplied by the caller (the group evaluator) so the join stays
 * a pure binding-set algebra.
 */
export type BindingFilter = (binding: TermBinding) => boolean;

/**
 * bindingsCompatible reports whether two solution bindings can be merged:
 * every variable bound in both must resolve to the same RDF term (compared
 * structurally, so RDF-star triple terms match by subject/predicate/object).
 */
export function bindingsCompatible(
  a: TermBinding,
  b: TermBinding,
): boolean {
  for (const key of Object.keys(a)) {
    const bValue = b[key];
    if (bValue !== undefined && !sameRdfTerm(a[key], bValue)) {
      return false;
    }
  }
  return true;
}

/**
 * leftJoin implements the OPTIONAL algebra: every left binding is extended
 * with each compatible right binding whose merged binding passes all
 * filters; when nothing matches, the left binding survives unextended. The
 * filters are the OPTIONAL group's own FILTER expressions, evaluated against
 * the merged binding so they can reference outer variables.
 */
export function leftJoin(
  left: TermBinding[],
  right: TermBinding[],
  filters: BindingFilter[] = [],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (filters.every((filter) => filter(merged))) {
        result.push(merged);
        matched = true;
      }
    }
    if (!matched) {
      result.push(l);
    }
  }
  return result;
}

/**
 * innerJoin merges two binding sets with a natural join: every compatible
 * pair of bindings (one from each side) combines into one result, preserving
 * multiset semantics. It threads a group element's independently evaluated
 * solutions (e.g. UNION branches) into the incoming solutions, matching the
 * Join(P, Union(Q1, Q2)) algebra translation.
 */
export function innerJoin(
  left: TermBinding[],
  right: TermBinding[],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    for (const r of right) {
      if (bindingsCompatible(l, r)) {
        result.push({ ...l, ...r });
      }
    }
  }
  return result;
}

/**
 * minus implements the MINUS algebra: a left binding is eliminated exactly
 * when some right binding shares at least one variable with it and is
 * compatible on all of them. Right bindings sharing no variables with a
 * left binding never eliminate it, per SPARQL 1.1 §18.2.2.9.
 */
export function minus(
  left: TermBinding[],
  right: TermBinding[],
): TermBinding[] {
  return left.filter((l) =>
    !right.some((r) => sharesVariable(l, r) && bindingsCompatible(l, r))
  );
}

/**
 * sharesVariable reports whether two bindings both bind at least one
 * variable in common.
 */
function sharesVariable(a: TermBinding, b: TermBinding): boolean {
  for (const key of Object.keys(a)) {
    if (b[key] !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * scanEntry resolves a triple pattern and pre-fetches the candidate quads
 * matching its constant positions.
 */
export function scanEntry(
  store: rdfjs.Store,
  pattern: Triple,
): Promise<ScanEntry> {
  const subject = pattern.subject;
  const predicate = simplePredicate(pattern.predicate);
  const object = pattern.object;
  return matchQuads(
    store,
    patternConstant(subject),
    patternConstant(predicate),
    patternConstant(object),
  ).then((candidates) => ({ subject, predicate, object, candidates }));
}

/**
 * joinTriplePattern joins the current bindings against a triple pattern with
 * a hash join: candidate quads come from the pattern's single indexed store
 * scan (performed once by the caller), and bindings probe a positional index
 * instead of issuing a stream round trip per binding.
 */
export function joinTriplePattern(
  currentBindings: TermBinding[],
  entry: ScanEntry,
): TermBinding[] {
  const subject = entry.subject;
  const predicate = entry.predicate;
  const object = entry.object;

  const subjectIsVariable = subject.termType === "Variable";
  const predicateIsVariable = predicate.termType === "Variable";
  const objectIsVariable = object.termType === "Variable";

  const candidateQuads = entry.candidates;

  const needsIndex = currentBindings.some((binding) =>
    (subjectIsVariable && binding[subject.value] !== undefined) ||
    (predicateIsVariable && binding[predicate.value] !== undefined) ||
    (objectIsVariable && binding[object.value] !== undefined)
  );
  const quadIndex = needsIndex ? buildQuadIndex(candidateQuads) : null;

  const nextBindings: TermBinding[] = [];

  for (const binding of currentBindings) {
    const resolvedSubject = resolveTerm(subject, binding);
    const resolvedPredicate = resolveTerm(predicate, binding);
    const resolvedObject = resolveTerm(object, binding);

    const matchingQuads = quadIndex === null ? candidateQuads : probeQuadIndex(
      quadIndex,
      candidateQuads,
      resolvedSubject,
      resolvedPredicate,
      resolvedObject,
    );

    for (const matchQuad of matchingQuads) {
      const newBinding = { ...binding };
      let valid = true;

      if (subjectIsVariable) {
        const varName = subject.value;
        const val = matchQuad.subject;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
        ) {
          valid = false;
        } else {
          newBinding[varName] = val;
        }
      }

      if (valid && predicateIsVariable) {
        const varName = predicate.value;
        const val = matchQuad.predicate;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
        ) {
          valid = false;
        } else {
          newBinding[varName] = val;
        }
      }

      if (valid && objectIsVariable) {
        const varName = object.value;
        const val = matchQuad.object;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
        ) {
          valid = false;
        } else {
          newBinding[varName] = val;
        }
      }

      if (valid) {
        nextBindings.push(newBinding);
      }
    }
  }

  return nextBindings;
}

/**
 * patternConstant returns the RDF/JS term for a constant pattern position, or
 * null when the position is a variable that must not constrain the scan.
 */
function patternConstant(term: SparqlTerm): rdfjs.Term | null {
  if (term.termType === "Variable") {
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

/**
 * resolveTerm resolves a pattern position against a solution binding: bound
 * variables return their term, unbound variables and constants return the
 * term itself (constants via conversion).
 */
function resolveTerm(
  term: SparqlTerm,
  binding: TermBinding,
): rdfjs.Term | null {
  if (term.termType === "Variable") {
    const bound = binding[term.value];
    if (bound) {
      return bound;
    }
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

import type * as rdfjs from "@rdfjs/types";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

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
export interface ScanEntry {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
  candidates: rdfjs.Quad[];
  /**
   * reifies marks a `?r rdf:reifies <<( s p o )>>` pattern, which joins by
   * decomposing each candidate's quoted-triple-term object instead of
   * matching the object position directly.
   */
  reifies?: boolean;
  /**
   * tripleTermObject marks a pattern whose object is a triple-term pattern
   * `?s ?p <<( ?st ?pt ?ot )>>`, which joins by decomposing each candidate's
   * triple-term object instead of probing the object position directly.
   */
  tripleTermObject?: boolean;
}

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

/** Shared empty result for joins with no right side (never mutated). */
export const EMPTY_BINDINGS: TermBinding[] = [];

/**
 * filterBindings applies a predicate to a binding iterable — the streaming
 * counterpart to Array#filter, for the lazy group evaluation (issue #74).
 */
export function* filterBindings(
  bindings: Iterable<TermBinding>,
  predicate: (binding: TermBinding) => boolean,
): Generator<TermBinding> {
  for (const binding of bindings) {
    if (predicate(binding)) {
      yield binding;
    }
  }
}

/**
 * mapBindings applies a transform to a binding iterable — the streaming
 * counterpart to Array#map, for the lazy group evaluation (issue #74).
 */
export function* mapBindings<T>(
  bindings: Iterable<TermBinding>,
  transform: (binding: TermBinding) => T,
): Generator<T> {
  for (const binding of bindings) {
    yield transform(binding);
  }
}

/**
 * sharedVars returns the sorted variables bound on both sides — the join
 * key dimensions. Bindings missing a shared variable are wildcards on it
 * (compatible with any value), which the candidate machinery handles.
 */
export function sharedVars(
  left: TermBinding[],
  right: TermBinding[],
): string[] {
  const rightVars = new Set<string>();
  for (const binding of right) {
    for (const key of Object.keys(binding)) {
      rightVars.add(key);
    }
  }
  const shared: string[] = [];
  for (const binding of left) {
    for (const key of Object.keys(binding)) {
      if (rightVars.has(key) && !shared.includes(key)) {
        shared.push(key);
      }
    }
  }
  return shared.sort();
}

/**
 * joinKey renders the hash key of a binding over the shared variables:
 * the term keys of the values it binds, with null for unbound positions.
 * JSON.stringify keeps the tuple collision-free for any term content.
 */
export function joinKey(
  binding: TermBinding,
  joinVars: string[],
): string {
  return JSON.stringify(joinVars.map((v) => {
    const t = binding[v];
    return t === undefined ? null : termKey(t);
  }));
}

/**
 * sharesVariable reports whether two bindings both bind at least one
 * variable in common.
 */
export function sharesVariable(a: TermBinding, b: TermBinding): boolean {
  for (const key of Object.keys(a)) {
    if (b[key] !== undefined) {
      return true;
    }
  }
  return false;
}

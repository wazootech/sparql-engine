import type * as rdfjs from "@rdfjs/types";
import { buildQuadIndex, probeQuadIndex } from "@/quad-store.ts";
import type { QuadIndex } from "@/quad-store.ts";
import type { ScanEntry, TermBinding } from "@/evaluator/join-bindings.ts";
import {
  getQueryVarName,
  isQueryVar,
  resolveTerm,
} from "@/evaluator/scan-entry.ts";
import {
  joinReifiesPattern,
  joinTripleTermObject,
} from "@/evaluator/join-reified.ts";
import { sameRdfTerm } from "@/term/mod.ts";

/**
 * joinTriplePattern joins the current bindings against a triple pattern with
 * a hash join: candidate quads come from the pattern's single indexed store
 * scan (performed once by the caller), and bindings probe a positional index
 * instead of issuing a stream round trip per binding. This array form is the
 * eager path: a single-pattern BGP (where there is no chain to stream), the
 * reordered BGP path (whose cost estimate needs the materialized result
 * set), and the synchronous EXISTS hooks. The lazy BGP chain uses
 * joinTriplePatternLazy instead.
 *
 * prebuiltIndex supplies an already-built QuadIndex (the EXISTS hooks' drained
 * snapshot index) so the join probes it directly instead of rebuilding an
 * index over the candidates on every call — the EXISTS hooks join one
 * solution at a time, so a fresh build there would re-index the candidates
 * per probe, and the main path reuses the snapshot when its universe
 * coincides with the current scope (see BgpEvaluator.existsIndexForScope).
 * graphScope filters the probed quads to one graph: the prebuilt snapshot
 * index spans every graph, so matches must be scoped before binding extension
 * (the main path's candidates are already graph-scoped via GraphScopedStore).
 */
export function joinTriplePattern(
  currentBindings: TermBinding[],
  entry: ScanEntry,
  prebuiltIndex?: QuadIndex | null,
  graphScope?: rdfjs.Term | null,
): TermBinding[] {
  if (entry.reifies) {
    return [...joinReifiesPattern(currentBindings, entry)];
  }
  if (entry.tripleTermObject) {
    return [...joinTripleTermObject(currentBindings, entry)];
  }
  const subject = entry.subject;
  const predicate = entry.predicate;
  const object = entry.object;

  const subjectIsVariable = isQueryVar(subject);
  const predicateIsVariable = isQueryVar(predicate);
  const objectIsVariable = isQueryVar(object);

  const candidateQuads = entry.candidates;

  const needsIndex = prebuiltIndex != null
    ? false
    : currentBindings.some((binding) =>
      (subjectIsVariable && binding[getQueryVarName(subject)] !== undefined) ||
      (predicateIsVariable &&
        binding[getQueryVarName(predicate)] !== undefined) ||
      (objectIsVariable && binding[getQueryVarName(object)] !== undefined)
    );
  const quadIndex = prebuiltIndex != null
    ? prebuiltIndex
    : needsIndex
    ? buildQuadIndex(candidateQuads)
    : null;

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
    const scopedQuads = graphScope === undefined || graphScope === null
      ? matchingQuads
      : matchingQuads.filter((item) => sameRdfTerm(item.graph, graphScope));

    for (const matchQuad of scopedQuads) {
      const newBinding = { ...binding };
      let valid = true;

      if (subjectIsVariable) {
        const varName = getQueryVarName(subject);
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
        const varName = getQueryVarName(predicate);
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
        const varName = getQueryVarName(object);
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

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
 * joinTriplePatternLazy is the generator form of joinTriplePattern (issue
 * #74 lazy slice): it emits extended bindings one at a time, so a chain of
 * BGP patterns streams solution bindings instead of materializing an array
 * per pattern. The positional index is still built over the pattern's
 * candidate bucket — the hash index build stays eager — but only on the
 * first binding that actually binds a pattern variable (bindings binding no
 * variable scan the candidates directly, which is exactly what the index
 * probe returns for them).
 */
export function* joinTriplePatternLazy(
  currentBindings: Iterable<TermBinding>,
  entry: ScanEntry,
  prebuiltIndex?: QuadIndex | null,
  graphScope?: rdfjs.Term | null,
): Generator<TermBinding> {
  if (entry.reifies) {
    yield* joinReifiesPattern(currentBindings, entry);
    return;
  }
  if (entry.tripleTermObject) {
    yield* joinTripleTermObject(currentBindings, entry);
    return;
  }
  const subject = entry.subject;
  const predicate = entry.predicate;
  const object = entry.object;

  const subjectIsVariable = isQueryVar(subject);
  const predicateIsVariable = isQueryVar(predicate);
  const objectIsVariable = isQueryVar(object);

  const candidateQuads = entry.candidates;

  let quadIndex: QuadIndex | null = prebuiltIndex ?? null;

  for (const binding of currentBindings) {
    const resolvedSubject = resolveTerm(subject, binding);
    const resolvedPredicate = resolveTerm(predicate, binding);
    const resolvedObject = resolveTerm(object, binding);

    if (
      quadIndex === null &&
      ((subjectIsVariable && binding[getQueryVarName(subject)] !== undefined) ||
        (predicateIsVariable &&
          binding[getQueryVarName(predicate)] !== undefined) ||
        (objectIsVariable && binding[getQueryVarName(object)] !== undefined))
    ) {
      quadIndex = buildQuadIndex(candidateQuads);
    }

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
        yield newBinding;
      }
    }
  }
}

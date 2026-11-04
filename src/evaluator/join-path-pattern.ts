import type { PathEntry } from "@/evaluator/path-types.ts";
import type { TermBinding } from "@/evaluator/join-bindings.ts";
import { sameRdfTerm, sparqlTermToRdfTerm } from "@/term/mod.ts";

/**
 * joinPathPattern joins the current bindings against a property-path entry:
 * each binding resolves its subject/object positions and keeps every pair
 * consistent with them, extending the binding with the pair's terms. This
 * array form is the eager path (single-pattern BGPs and the synchronous
 * EXISTS hooks); the lazy BGP chain uses joinPathPatternLazy.
 */
export function joinPathPattern(
  currentBindings: TermBinding[],
  entry: PathEntry,
): TermBinding[] {
  const { subject, object, pairs } = entry;
  const subjectIsVariable = subject.termType === "Variable";
  const objectIsVariable = object.termType === "Variable";
  const nextBindings: TermBinding[] = [];

  for (const binding of currentBindings) {
    const resolvedSubject = subjectIsVariable
      ? binding[subject.value] ?? null
      : sparqlTermToRdfTerm(subject);
    const resolvedObject = objectIsVariable
      ? binding[object.value] ?? null
      : sparqlTermToRdfTerm(object);

    for (const pair of pairs) {
      if (
        resolvedSubject !== null &&
        !sameRdfTerm(pair.subject, resolvedSubject)
      ) {
        continue;
      }
      if (
        resolvedObject !== null &&
        !sameRdfTerm(pair.object, resolvedObject)
      ) {
        continue;
      }
      const newBinding = { ...binding };
      let valid = true;
      if (subjectIsVariable) {
        const existing = newBinding[subject.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.subject)) {
          valid = false;
        } else {
          newBinding[subject.value] = pair.subject;
        }
      }
      if (valid && objectIsVariable) {
        const existing = newBinding[object.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.object)) {
          valid = false;
        } else {
          newBinding[object.value] = pair.object;
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
 * joinPathPatternLazy is the generator form of joinPathPattern (issue #74
 * lazy slice): property paths stream inside the lazy BGP chain, so a path
 * pattern emits extended bindings one at a time.
 */
export function* joinPathPatternLazy(
  currentBindings: Iterable<TermBinding>,
  entry: PathEntry,
): Generator<TermBinding> {
  const { subject, object, pairs } = entry;
  const subjectIsVariable = subject.termType === "Variable";
  const objectIsVariable = object.termType === "Variable";

  for (const binding of currentBindings) {
    const resolvedSubject = subjectIsVariable
      ? binding[subject.value] ?? null
      : sparqlTermToRdfTerm(subject);
    const resolvedObject = objectIsVariable
      ? binding[object.value] ?? null
      : sparqlTermToRdfTerm(object);

    for (const pair of pairs) {
      if (
        resolvedSubject !== null &&
        !sameRdfTerm(pair.subject, resolvedSubject)
      ) {
        continue;
      }
      if (
        resolvedObject !== null &&
        !sameRdfTerm(pair.object, resolvedObject)
      ) {
        continue;
      }
      const newBinding = { ...binding };
      let valid = true;
      if (subjectIsVariable) {
        const existing = newBinding[subject.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.subject)) {
          valid = false;
        } else {
          newBinding[subject.value] = pair.subject;
        }
      }
      if (valid && objectIsVariable) {
        const existing = newBinding[object.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.object)) {
          valid = false;
        } else {
          newBinding[object.value] = pair.object;
        }
      }
      if (valid) {
        yield newBinding;
      }
    }
  }
}

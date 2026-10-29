import type { RdfTerm } from "@/parser/rdf-terms.ts";
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
    for (const pair of pairs) {
      // Each endpoint is either bound in this solution or constant in the
      // pattern, and the two cases stay in separate branches. Folding them
      // into one `RdfTerm | undefined` local (a ternary over an unbound read)
      // hands the native compiler (scriptc) an undefined value in a union
      // slot, which aborts the build at runtime.
      if (subjectIsVariable) {
        const boundSubject: RdfTerm | undefined = binding[subject.value];
        if (
          boundSubject !== undefined &&
          !sameRdfTerm(pair.subject, boundSubject)
        ) {
          continue;
        }
      } else if (!sameRdfTerm(pair.subject, sparqlTermToRdfTerm(subject))) {
        continue;
      }
      if (objectIsVariable) {
        const boundObject: RdfTerm | undefined = binding[object.value];
        if (
          boundObject !== undefined &&
          !sameRdfTerm(pair.object, boundObject)
        ) {
          continue;
        }
      } else if (!sameRdfTerm(pair.object, sparqlTermToRdfTerm(object))) {
        continue;
      }
      const newBinding = { ...binding };
      let valid = true;
      if (subjectIsVariable) {
        const existing: RdfTerm | undefined = newBinding[subject.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.subject)) {
          valid = false;
        } else {
          newBinding[subject.value] = pair.subject;
        }
      }
      if (valid && objectIsVariable) {
        const existing: RdfTerm | undefined = newBinding[object.value];
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
    for (const pair of pairs) {
      // Same branch split as joinPathPattern: an unbound variable read never
      // reaches a union-typed local, which scriptc cannot represent.
      if (subjectIsVariable) {
        const boundSubject: RdfTerm | undefined = binding[subject.value];
        if (
          boundSubject !== undefined &&
          !sameRdfTerm(pair.subject, boundSubject)
        ) {
          continue;
        }
      } else if (!sameRdfTerm(pair.subject, sparqlTermToRdfTerm(subject))) {
        continue;
      }
      if (objectIsVariable) {
        const boundObject: RdfTerm | undefined = binding[object.value];
        if (
          boundObject !== undefined &&
          !sameRdfTerm(pair.object, boundObject)
        ) {
          continue;
        }
      } else if (!sameRdfTerm(pair.object, sparqlTermToRdfTerm(object))) {
        continue;
      }
      const newBinding = { ...binding };
      let valid = true;
      if (subjectIsVariable) {
        const existing: RdfTerm | undefined = newBinding[subject.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.subject)) {
          valid = false;
        } else {
          newBinding[subject.value] = pair.subject;
        }
      }
      if (valid && objectIsVariable) {
        const existing: RdfTerm | undefined = newBinding[object.value];
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

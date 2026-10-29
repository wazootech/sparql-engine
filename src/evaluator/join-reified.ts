import type * as rdfjs from "@rdfjs/types";
import type { ScanEntry, TermBinding } from "@/evaluator/join-bindings.ts";
import type { RdfQuad, RdfQuadGraph, RdfTerm, RdfBaseQuad } from "@/parser/rdf-terms.ts";
import { matchPatternTerm } from "@/evaluator/scan-entry.ts";

/**
 * joinReifiesPattern joins solutions against a `?r rdf:reifies <<( s p o )>>`
 * pattern. Each candidate `X rdf:reifies TT` decomposes its quoted triple term
 * TT and matches its subject/predicate/object against the pattern's three
 * positions (binding variables, recursively through nested triple terms),
 * then binds the reifier position to X. Emits incrementally (issue #74).
 */
export function joinReifiesPattern(
  currentBindings: TermBinding[],
  entry: ScanEntry,
): TermBinding[] {
  const reifier = entry.subject;
  const tripleTerm = entry.object as RdfBaseQuad;
  const out: TermBinding[] = [];
  for (
    let bindingIndex = 0;
    bindingIndex < currentBindings.length;
    bindingIndex++
  ) {
    const binding = currentBindings[bindingIndex];
    for (
      let candidateIndex = 0;
      candidateIndex < entry.candidates.length;
      candidateIndex++
    ) {
      const candidate = entry.candidates[candidateIndex];
      if (candidate.object.termType !== "Quad") {
        continue;
      }
      const quoted = candidate.object as RdfBaseQuad;
      let extended = matchPatternTerm(
        tripleTerm.subject,
        quoted.subject,
        binding,
      );
      if (extended === null) {
        continue;
      }
      extended = matchPatternTerm(
        tripleTerm.predicate,
        quoted.predicate,
        extended,
      );
      if (extended === null) {
        continue;
      }
      extended = matchPatternTerm(
        tripleTerm.object,
        quoted.object,
        extended,
      );
      if (extended === null) {
        continue;
      }
      const bound = matchPatternTerm(reifier, candidate.subject, extended);
      if (bound !== null) {
        out.push(bound);
      }
    }
  }
  return out;
}

/**
 * joinTripleTermObject joins solutions against a triple pattern whose object
 * is a triple-term pattern `?s ?p <<( ?st ?pt ?ot )>>`. Each candidate quad
 * with a triple-term object matches the subject/predicate positionally and
 * the object recursively through the triple-term pattern's positions.
 */
export function joinTripleTermObject(
  currentBindings: TermBinding[],
  entry: ScanEntry,
): TermBinding[] {
  const out: TermBinding[] = [];
  for (
    let bindingIndex = 0;
    bindingIndex < currentBindings.length;
    bindingIndex++
  ) {
    const binding = currentBindings[bindingIndex];
    for (
      let candidateIndex = 0;
      candidateIndex < entry.candidates.length;
      candidateIndex++
    ) {
      const candidate = entry.candidates[candidateIndex];
      if (candidate.object.termType !== "Quad") {
        continue;
      }
      let extended = matchPatternTerm(
        entry.subject,
        candidate.subject,
        binding,
      );
      if (extended === null) {
        continue;
      }
      extended = matchPatternTerm(
        entry.predicate,
        candidate.predicate,
        extended,
      );
      if (extended === null) {
        continue;
      }
      const bound = matchPatternTerm(
        entry.object,
        candidate.object,
        extended,
      );
      if (bound !== null) {
        out.push(bound);
      }
    }
  }
  return out;
}

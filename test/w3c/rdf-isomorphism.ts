import type * as rdfjs from "@rdfjs/types";
import { canonicalizeRdfTerm } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";

/* ------------------------------------------------------------------ */
/* Quad-set isomorphism (Weisfeiler-Lehman blank-node canonicalization). */
/* ------------------------------------------------------------------ */

/** Canonical record for one quad: [subject, predicate, object, graph]. */
type QuadRecord = [
  CanonicalTerm,
  CanonicalTerm,
  CanonicalTerm,
  CanonicalTerm,
];

function quadRecords(quads: rdfjs.Quad[]): QuadRecord[] {
  return quads.map((q) => [
    canonicalizeRdfTerm(q.subject),
    canonicalizeRdfTerm(q.predicate),
    canonicalizeRdfTerm(q.object),
    canonicalizeRdfTerm(q.graph),
  ]);
}

function refersTo(term: CanonicalTerm, label: string): boolean {
  if (term.termType === "BlankNode") return term.value === label;
  if (term.termType === "Quad") {
    return (term.subject !== undefined && refersTo(term.subject, label)) ||
      (term.predicate !== undefined && refersTo(term.predicate, label)) ||
      (term.object !== undefined && refersTo(term.object, label));
  }
  return false;
}

function renderValue(
  term: CanonicalTerm,
  map: Map<string, string>,
): Record<string, unknown> {
  if (term.termType === "BlankNode") {
    return { termType: "BlankNode", value: map.get(term.value) ?? "_" };
  }
  if (term.termType === "Quad") {
    return {
      termType: "Quad",
      value: "",
      subject: term.subject ? renderValue(term.subject, map) : undefined,
      predicate: term.predicate ? renderValue(term.predicate, map) : undefined,
      object: term.object ? renderValue(term.object, map) : undefined,
    };
  }
  return term;
}

function render(term: CanonicalTerm, map: Map<string, string>): string {
  return JSON.stringify(renderValue(term, map));
}

function collectLabels(records: QuadRecord[]): Set<string> {
  const labels = new Set<string>();
  const visit = (term: CanonicalTerm): void => {
    if (term.termType === "BlankNode") labels.add(term.value);
    else if (term.termType === "Quad") {
      if (term.subject) visit(term.subject);
      if (term.predicate) visit(term.predicate);
      if (term.object) visit(term.object);
    }
  };
  for (const record of records) for (const slot of record) visit(slot);
  return labels;
}

function canonicalizeRecords(records: QuadRecord[]): string[] {
  const labels = collectLabels(records);

  let current = new Map<string, string>();
  for (const label of labels) current.set(label, "s0");

  for (let round = 0; round <= labels.size + 1; round++) {
    const signature = new Map<string, string>();
    for (const label of labels) {
      const contexts: string[] = [];
      for (const record of records) {
        for (let slot = 0; slot < record.length; slot++) {
          if (refersTo(record[slot], label)) {
            const others = record
              .filter((_, index) => index !== slot)
              .map((term) => render(term, current));
            contexts.push(JSON.stringify([slot, ...others]));
          }
        }
      }
      contexts.sort();
      signature.set(label, JSON.stringify(contexts));
    }
    const distinct = [...new Set(signature.values())].sort();
    const idOf = new Map(distinct.map((text, index) => [text, `s${index}`]));
    current = new Map(
      [...labels].map((label) => [label, idOf.get(signature.get(label)!)!]),
    );
  }

  const ordered = [...labels].sort((a, b) => {
    const aId = current.get(a)!;
    const bId = current.get(b)!;
    if (aId !== bId) return aId < bId ? -1 : 1;
    return a < b ? -1 : 1;
  });
  const canonical = new Map<string, string>();
  ordered.forEach((label, index) => canonical.set(label, `_:${index}`));

  return records.map((record) =>
    record.map((term) => render(term, canonical)).join("\u0000")
  );
}

function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of b) {
    const remaining = counts.get(item);
    if (remaining === undefined || remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

/** True when two quad sets are equal up to blank-node relabeling. */
export function quadSetsIsomorphic(
  a: rdfjs.Quad[],
  b: rdfjs.Quad[],
): boolean {
  if (a.length !== b.length) return false;
  return multisetEqual(
    canonicalizeRecords(quadRecords(a)),
    canonicalizeRecords(quadRecords(b)),
  );
}

/**
 * True when two quad lists are equal as RDF graphs (duplicate triples
 * collapsed) up to blank-node relabeling. W3C `.nt`/`.nq` reference results
 * serialize the RDF graph as a set, so a statement repeated in the input
 * appears once; this comparison matches that semantics.
 */
export function quadSetsIsomorphicAsSets(
  a: rdfjs.Quad[],
  b: rdfjs.Quad[],
): boolean {
  return multisetEqual(
    [...new Set(canonicalizeRecords(quadRecords(a)))],
    [...new Set(canonicalizeRecords(quadRecords(b)))],
  );
}

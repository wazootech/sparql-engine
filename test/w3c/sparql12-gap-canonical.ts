import type { CanonicalTerm } from "@/term/mod.ts";

/* ------------------------------------------------------------------ */
/* Blank-node-isomorphic multiset comparison (Weisfeiler-Lehman).     */
/* ------------------------------------------------------------------ */

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

function canonicalizeBnodes(records: CanonicalTerm[][]): string[] {
  const labels = new Set<string>();
  const visit = (term: CanonicalTerm): void => {
    if (term.termType === "BlankNode") labels.add(term.value);
    else if (term.termType === "Quad") {
      if (term.subject) visit(term.subject);
      if (term.predicate) visit(term.predicate);
      if (term.object) visit(term.object);
    }
  };
  for (const record of records) for (const term of record) visit(term);

  const renderValue = (
    term: CanonicalTerm,
    map: Map<string, string>,
  ): Record<string, unknown> => {
    if (term.termType === "BlankNode") {
      return { termType: "BlankNode", value: map.get(term.value) ?? "_" };
    }
    if (term.termType === "Quad") {
      return {
        termType: "Quad",
        value: "",
        subject: term.subject ? renderValue(term.subject, map) : undefined,
        predicate: term.predicate
          ? renderValue(term.predicate, map)
          : undefined,
        object: term.object ? renderValue(term.object, map) : undefined,
      };
    }
    return term;
  };
  const render = (term: CanonicalTerm, map: Map<string, string>): string =>
    JSON.stringify(renderValue(term, map));

  const refersTo = (term: CanonicalTerm, label: string): boolean => {
    if (term.termType === "BlankNode") return term.value === label;
    if (term.termType === "Quad") {
      return (term.subject !== undefined && refersTo(term.subject, label)) ||
        (term.predicate !== undefined && refersTo(term.predicate, label)) ||
        (term.object !== undefined && refersTo(term.object, label));
    }
    return false;
  };

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

export function isomorphicMultiset(
  a: CanonicalTerm[][],
  b: CanonicalTerm[][],
): boolean {
  if (a.length !== b.length) return false;
  return multisetEqual(canonicalizeBnodes(a), canonicalizeBnodes(b));
}

export function bindingRecord(record: Record<string, CanonicalTerm>): string {
  return JSON.stringify(
    Object.keys(record).sort().map((name) => [name, record[name]]),
  );
}

export function recordsOf(
  bindings: Record<string, CanonicalTerm>[],
): CanonicalTerm[][] {
  return bindings.map((record) =>
    Object.keys(record).sort().map((name) => record[name])
  );
}

/* ------------------------------------------------------------------ */
/* Reference result parsing.                                          */
/* ------------------------------------------------------------------ */

export function srjValueToCanonical(raw: unknown): CanonicalTerm {
  const value = raw as {
    type: string;
    value: unknown;
    "xml:lang"?: string;
    "its:dir"?: string;
    datatype?: string;
  };
  switch (value.type) {
    case "uri":
      return { termType: "NamedNode", value: String(value.value) };
    case "bnode":
      return { termType: "BlankNode", value: String(value.value) };
    case "literal": {
      const canonical: CanonicalTerm = {
        termType: "Literal",
        value: String(value.value),
      };
      if (value["xml:lang"]) {
        canonical.language = value["xml:lang"];
        if (value["its:dir"]) canonical.direction = value["its:dir"];
      } else if (value.datatype && value.datatype !== XSD_STRING) {
        canonical.datatype = value.datatype;
      }
      return canonical;
    }
    case "triple": {
      const triple = value.value as {
        subject: unknown;
        predicate: unknown;
        object: unknown;
      };
      return {
        termType: "Quad",
        value: "",
        subject: srjValueToCanonical(triple.subject),
        predicate: srjValueToCanonical(triple.predicate),
        object: srjValueToCanonical(triple.object),
      };
    }
    default:
      throw new Error(`Unknown srj value type: ${value.type}`);
  }
}

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

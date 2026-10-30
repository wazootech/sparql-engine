import type * as rdfjs from "@rdfjs/types";
import { canonicalizeRdfTerm } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import { SparqlParser as SparqlJsParser } from "@/parser/sparql-parser.ts";

/**
 * normalizeComunicaBlankNodeLabel strips the per-source blank node prefix that
 * Comunica's query-source skolemization applies to results. Comunica rewrites
 * blank nodes into "bc_<sourceId>_<label>" (BlankNodeScoped) so that identical
 * labels from different sources stay distinct. Blank node labels are opaque per
 * SPARQL 1.1 result semantics, and the wazoo engine deliberately returns the
 * store's own labels, so the prefix is removed before comparison.
 */
function normalizeComunicaBlankNodeLabel(label: string): string {
  return label.replace(/^bc_\d+_/, "");
}

/**
 * canonicalizeComunicaTerm normalizes an RDF/JS term returned by the Comunica
 * engine, stripping the cosmetic blank node prefix Comunica applies to results.
 */
export function canonicalizeComunicaTerm(term: rdfjs.Term): CanonicalTerm {
  const canonical = canonicalizeRdfTerm(term);
  if (canonical.termType === "BlankNode") {
    canonical.value = normalizeComunicaBlankNodeLabel(canonical.value);
  }
  return canonical;
}

/**
 * canonicalBindingRecord renders a binding as a deterministic, sorted string.
 */
export function canonicalBindingRecord(
  binding: Record<string, CanonicalTerm>,
): string {
  const pairs = Object.keys(binding)
    .sort()
    .map((name) => `${name}=${JSON.stringify(binding[name])}`);
  return `{${pairs.join(", ")}}`;
}

/**
 * canonicalQuadString renders a quad as a deterministic string.
 */
export function canonicalQuadString(item: rdfjs.Quad): string {
  const subject = JSON.stringify(canonicalizeRdfTerm(item.subject));
  const predicate = JSON.stringify(canonicalizeRdfTerm(item.predicate));
  const object = JSON.stringify(canonicalizeRdfTerm(item.object));
  const graph = JSON.stringify(canonicalizeRdfTerm(item.graph));
  return `${subject} ${predicate} ${object} ${graph}`;
}

/**
 * canonicalComunicaQuadString renders a Comunica quad as a deterministic
 * string with the cosmetic blank node prefix stripped.
 */
export function canonicalComunicaQuadString(item: rdfjs.Quad): string {
  const subject = JSON.stringify(canonicalizeComunicaTerm(item.subject));
  const predicate = JSON.stringify(canonicalizeComunicaTerm(item.predicate));
  const object = JSON.stringify(canonicalizeComunicaTerm(item.object));
  const graph = JSON.stringify(canonicalizeComunicaTerm(item.graph));
  return `${subject} ${predicate} ${object} ${graph}`;
}

/**
 * extractSelectVars returns the projected variable names of a SELECT query, or
 * null when the projection is a wildcard or expression that cannot be derived
 * statically.
 */
export function extractSelectVars(query: string): string[] | null {
  // Best-effort: queries that need a base to parse (e.g. a relative PREFIX
  // IRI without a BASE directive) yield no static projection — the caller
  // then skips the variable-count cross-check rather than failing the case.
  let ast;
  try {
    ast = new SparqlJsParser().parse(query);
  } catch {
    return null;
  }
  if (ast.type !== "query" || ast.queryType !== "SELECT") {
    return null;
  }
  const vars: string[] = [];
  for (const variable of ast.variables) {
    if (typeof variable === "string") {
      vars.push(variable);
    } else if (
      "termType" in variable && variable.termType === "Variable"
    ) {
      vars.push(variable.value);
    } else {
      return null;
    }
  }
  return vars;
}

/**
 * compareVars compares projected variable sets, returning a mismatch message.
 */
export function compareVars(
  expected: string[] | null,
  actual: string[],
): string | null {
  if (expected === null) {
    return null;
  }
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  if (sortedExpected.length !== sortedActual.length) {
    return (
      `Projected variable count mismatch: expected ${sortedExpected.length} ` +
      `but got ${sortedActual.length}`
    );
  }
  for (let index = 0; index < sortedExpected.length; index++) {
    if (sortedExpected[index] !== sortedActual[index]) {
      return (
        `Projected variable mismatch at index ${index}: ` +
        `expected "${sortedExpected[index]}" but got "${sortedActual[index]}"`
      );
    }
  }
  return null;
}

/**
 * compareMultisets compares two order-insensitive result lists.
 */
export function compareMultisets(
  expected: string[],
  actual: string[],
  label: string,
): string | null {
  const sortedExpected = [...expected].sort();
  const sortedActual = [...actual].sort();
  if (sortedExpected.length !== sortedActual.length) {
    return (
      `${label} count mismatch: expected ${sortedExpected.length} ` +
      `but got ${sortedActual.length}`
    );
  }
  for (let index = 0; index < sortedExpected.length; index++) {
    if (sortedExpected[index] !== sortedActual[index]) {
      return [
        `${label} mismatch at sorted index ${index}:`,
        `expected: ${sortedExpected[index]}`,
        `actual:   ${sortedActual[index]}`,
      ].join("\n");
    }
  }
  return null;
}

/**
 * compareOrdered compares two order-sensitive result lists element by element.
 */
export function compareOrdered(
  expected: string[],
  actual: string[],
  label: string,
): string | null {
  if (expected.length !== actual.length) {
    return (
      `${label} count mismatch: expected ${expected.length} ` +
      `but got ${actual.length}`
    );
  }
  for (let index = 0; index < expected.length; index++) {
    if (expected[index] !== actual[index]) {
      return [
        `${label} order mismatch at index ${index}:`,
        `expected: ${expected[index]}`,
        `actual:   ${actual[index]}`,
      ].join("\n");
    }
  }
  return null;
}

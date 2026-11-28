/**
 * cast-operand.ts reads the operands the constructor functions share.
 */

import type { RdfLiteral } from "@/parser/rdf-terms.ts";
import { XSD_STRING } from "@/term/mod.ts";
import { typedValue } from "@/term/typed-value.ts";

/** booleanOperand is 1 or 0 for a valid xsd:boolean literal, else null. */
export function booleanOperand(term: RdfLiteral): number | null {
  const typed = typedValue(term);
  return typed === null || typed.family !== "boolean"
    ? null
    : typed.value.seconds;
}

/** stringOperand is a string literal's text; a language tag disqualifies it. */
export function stringOperand(term: RdfLiteral): string | null {
  const datatype = term.datatype?.value;
  const tagged = term.language !== undefined && term.language !== "";
  const plain = datatype === undefined || datatype === XSD_STRING;
  return plain && !tagged ? term.value : null;
}

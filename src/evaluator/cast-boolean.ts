/**
 * cast-boolean.ts implements the xsd:boolean, xsd:dateTime and xsd:date
 * constructor functions (SPARQL 1.1 §17.5; xsd:date as Comunica adds it).
 */

import type { RdfLiteral, RdfTerm } from "@/parser/rdf-terms.ts";
import { booleanOperand, stringOperand } from "@/evaluator/cast-operand.ts";
import {
  DataFactory,
  numericValue,
  XSD_BOOLEAN,
  XSD_DATETIME,
} from "@/term/mod.ts";
import { typedValue } from "@/term/typed-value.ts";
import { timezoneOf, XSD_DATE } from "@/term/datetime.ts";

const { literal, namedNode } = DataFactory;

/** castToBoolean implements xsd:boolean(x): zero and NaN are false. */
export function castToBoolean(
  term: RdfTerm | undefined,
): RdfLiteral | undefined {
  if (term === undefined || term.termType !== "Literal") {
    return undefined;
  }
  const boolean = (value: boolean): RdfLiteral =>
    literal(value ? "true" : "false", namedNode(XSD_BOOLEAN));
  if (term.datatype?.value === XSD_BOOLEAN) {
    const flag = booleanOperand(term);
    return flag === null ? undefined : boolean(flag === 1);
  }
  const numeric = numericValue(term);
  if (numeric !== null) {
    if (typeof numeric === "bigint") {
      return boolean(numeric !== 0n);
    }
    return boolean(numeric !== 0 && !Number.isNaN(numeric));
  }
  const text = stringOperand(term);
  if (text === "true" || text === "1") {
    return boolean(true);
  }
  return text === "false" || text === "0" ? boolean(false) : undefined;
}

/**
 * castToDateTime implements xsd:dateTime(x): a valid dateTime or its string
 * form, and an xsd:date at the start of its day.
 */
export function castToDateTime(
  term: RdfTerm | undefined,
): RdfLiteral | undefined {
  if (term === undefined || term.termType !== "Literal") {
    return undefined;
  }
  const typed = typedValue(term);
  if (term.datatype?.value === XSD_DATETIME) {
    return typed === null ? undefined : term;
  }
  const dateTime = (text: string): RdfLiteral =>
    literal(text, namedNode(XSD_DATETIME));
  if (typed !== null && typed.family === "date") {
    const zone = timezoneOf(term.value);
    const day = term.value.slice(0, term.value.length - zone.length);
    return dateTime(`${day}T00:00:00${zone}`);
  }
  const text = stringOperand(term);
  if (text === null) {
    return undefined;
  }
  const candidate = dateTime(text);
  return typedValue(candidate) === null ? undefined : candidate;
}

/**
 * castToDate implements xsd:date(x): a valid date or its string form, and the
 * date of an xsd:dateTime in the same timezone.
 */
export function castToDate(term: RdfTerm | undefined): RdfLiteral | undefined {
  if (term === undefined || term.termType !== "Literal") {
    return undefined;
  }
  const typed = typedValue(term);
  if (term.datatype?.value === XSD_DATE) {
    return typed === null ? undefined : term;
  }
  const date = (text: string): RdfLiteral => literal(text, namedNode(XSD_DATE));
  if (typed !== null && typed.family === "dateTime") {
    const day = term.value.slice(0, term.value.indexOf("T"));
    return date(day + timezoneOf(term.value));
  }
  const text = stringOperand(term);
  if (text === null) {
    return undefined;
  }
  const candidate = date(text);
  return typedValue(candidate) === null ? undefined : candidate;
}

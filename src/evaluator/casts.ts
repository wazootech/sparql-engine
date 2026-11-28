/**
 * casts.ts implements the SPARQL 1.1 constructor functions (§17.5) other than
 * xsd:string. A cast that has no value for its operand returns undefined, the
 * unbound of an expression error.
 */

import type { RdfLiteral, RdfTerm } from "@/parser/rdf-terms.ts";
import {
  canonicalDouble,
  DataFactory,
  formatNumber,
  numberFromText,
  numericValue,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
} from "@/term/mod.ts";
import { doubleFromText } from "@/term/numeric.ts";
import { booleanOperand, stringOperand } from "@/evaluator/cast-operand.ts";

const { literal, namedNode } = DataFactory;

const INTEGER_TEXT = /^[+-]?[0-9]+$/;
const DECIMAL_TEXT = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/** castToInteger implements xsd:integer(x), truncating toward zero. */
export function castToInteger(
  term: RdfTerm | undefined,
): RdfLiteral | undefined {
  if (term === undefined || term.termType !== "Literal") {
    return undefined;
  }
  const integer = (text: string): RdfLiteral =>
    literal(text, namedNode(XSD_INTEGER));
  if (term.datatype?.value === XSD_BOOLEAN) {
    const flag = booleanOperand(term);
    return flag === null ? undefined : integer(String(flag));
  }
  const numeric = numericValue(term);
  if (numeric !== null) {
    if (typeof numeric === "bigint") {
      return integer(numeric.toString());
    }
    return Number.isFinite(numeric)
      ? integer(BigInt(Math.trunc(numeric)).toString())
      : undefined;
  }
  const text = stringOperand(term)?.trim();
  return text !== undefined && INTEGER_TEXT.test(text)
    ? integer(BigInt(text).toString())
    : undefined;
}

/** castToDecimal implements xsd:decimal(x). */
export function castToDecimal(
  term: RdfTerm | undefined,
): RdfLiteral | undefined {
  if (term === undefined || term.termType !== "Literal") {
    return undefined;
  }
  const decimal = (text: string): RdfLiteral =>
    literal(text, namedNode(XSD_DECIMAL));
  if (term.datatype?.value === XSD_BOOLEAN) {
    const flag = booleanOperand(term);
    return flag === null ? undefined : decimal(String(flag));
  }
  const numeric = numericValue(term);
  if (numeric !== null) {
    if (typeof numeric === "bigint") {
      return decimal(numeric.toString());
    }
    return Number.isFinite(numeric)
      ? decimal(formatNumber(numeric, XSD_DECIMAL))
      : undefined;
  }
  const text = stringOperand(term)?.trim();
  return text !== undefined && DECIMAL_TEXT.test(text)
    ? decimal(formatNumber(numberFromText(text), XSD_DECIMAL))
    : undefined;
}

/** floatingOperand is the value xsd:double(x) and xsd:float(x) convert. */
function floatingOperand(term: RdfTerm | undefined): number | null {
  if (term === undefined || term.termType !== "Literal") {
    return null;
  }
  if (term.datatype?.value === XSD_BOOLEAN) {
    return booleanOperand(term);
  }
  const numeric = numericValue(term);
  if (numeric !== null) {
    return typeof numeric === "bigint"
      ? numberFromText(numeric.toString())
      : numeric;
  }
  const text = stringOperand(term);
  return text === null ? null : doubleFromText(text);
}

/** castToDouble implements xsd:double(x) in the canonical XPath form. */
export function castToDouble(
  term: RdfTerm | undefined,
): RdfLiteral | undefined {
  const value = floatingOperand(term);
  return value === null
    ? undefined
    : literal(canonicalDouble(value), namedNode(XSD_DOUBLE));
}

/** castToFloat implements xsd:float(x) in the Number string form. */
export function castToFloat(term: RdfTerm | undefined): RdfLiteral | undefined {
  const value = floatingOperand(term);
  return value === null
    ? undefined
    : literal(formatNumber(value, XSD_FLOAT), namedNode(XSD_FLOAT));
}

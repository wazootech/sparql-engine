import type { RdfLiteral } from "@/parser/rdf-terms.ts";

/**
 * XSD is the XML Schema datatype namespace IRI.
 */
export const XSD = "http://www.w3.org/2001/XMLSchema#";

/** XSD_STRING is the xsd:string datatype IRI. */
export const XSD_STRING: string = `${XSD}string`;

/** XSD_BOOLEAN is the xsd:boolean datatype IRI. */
export const XSD_BOOLEAN: string = `${XSD}boolean`;

/** XSD_INTEGER is the xsd:integer datatype IRI. */
export const XSD_INTEGER: string = `${XSD}integer`;

/** XSD_DECIMAL is the xsd:decimal datatype IRI. */
export const XSD_DECIMAL: string = `${XSD}decimal`;

/** XSD_FLOAT is the xsd:float datatype IRI. */
export const XSD_FLOAT: string = `${XSD}float`;

/** XSD_DOUBLE is the xsd:double datatype IRI. */
export const XSD_DOUBLE: string = `${XSD}double`;

/** XSD_DATETIME is the xsd:dateTime datatype IRI. */
export const XSD_DATETIME: string = `${XSD}dateTime`;

/** XSD_DAYTIME_DURATION is the xsd:dayTimeDuration datatype IRI. */
export const XSD_DAYTIME_DURATION: string = `${XSD}dayTimeDuration`;

/** INTEGER_DATATYPES is xsd:integer and every type XML Schema derives from it. */
const INTEGER_DATATYPES: ReadonlySet<string> = new Set([
  XSD_INTEGER,
  `${XSD}nonPositiveInteger`,
  `${XSD}negativeInteger`,
  `${XSD}long`,
  `${XSD}int`,
  `${XSD}short`,
  `${XSD}byte`,
  `${XSD}nonNegativeInteger`,
  `${XSD}unsignedLong`,
  `${XSD}unsignedInt`,
  `${XSD}unsignedShort`,
  `${XSD}unsignedByte`,
  `${XSD}positiveInteger`,
]);

/**
 * NUMERIC_DATATYPES is the set of XSD datatypes with numeric value semantics
 * per SPARQL 1.1 §17.1, including the types derived from xsd:integer:
 * comparisons and arithmetic operate on their values rather than their lexical
 * forms.
 */
export const NUMERIC_DATATYPES: ReadonlySet<string> = new Set([
  ...INTEGER_DATATYPES,
  XSD_DECIMAL,
  XSD_FLOAT,
  XSD_DOUBLE,
]);

const DECIMAL_NUMBER_FORM =
  /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const INFINITY_FORM = /^[+-]?Infinity$/;
const RADIX_FORMS: [RegExp, number][] = [
  [/^0[xX][0-9a-fA-F]+$/, 16],
  [/^0[oO][0-7]+$/, 8],
  [/^0[bB][01]+$/, 2],
];

/**
 * numberFromText parses a numeric lexical form as a JS number with the
 * ToNumber semantics of `Number(text)`: surrounding whitespace is ignored,
 * blank text is 0, and anything that is not a decimal, infinity, or
 * radix-prefixed form is NaN. Every branch is statically typed, so the native
 * compiler keeps it out of the dynamic tier (scriptc issues #221 and #247).
 */
export function numberFromText(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  if (DECIMAL_NUMBER_FORM.test(trimmed)) {
    return parseFloat(trimmed);
  }
  if (INFINITY_FORM.test(trimmed)) {
    return trimmed.startsWith("-") ? -Infinity : Infinity;
  }
  for (const [form, radix] of RADIX_FORMS) {
    if (form.test(trimmed)) {
      return parseInt(trimmed.slice(2), radix);
    }
  }
  return NaN;
}

/**
 * doubleFromText parses an xsd:float or xsd:double lexical form: the XML Schema
 * spellings INF, +INF, -INF and NaN, or anything numberFromText reads. It
 * returns null for any other text, so NaN stays a value.
 */
export function doubleFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "NaN") {
    return NaN;
  }
  if (trimmed === "INF" || trimmed === "+INF") {
    return Infinity;
  }
  if (trimmed === "-INF") {
    return -Infinity;
  }
  const parsed = numberFromText(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * numberFromNumeric converts a numeric value to a JS number. A bigint goes
 * through its exact decimal form, so the result keeps `Number(bigint)`
 * rounding without the dynamic `Number()` constructor.
 */
export function numberFromNumeric(value: number | bigint): number {
  return typeof value === "bigint" ? parseFloat(value.toString()) : value;
}

/**
 * numericValue extracts the numeric value of a literal, or null when it is
 * not numeric or its lexical form is malformed. xsd:integer and its derived
 * types parse with BigInt for exact arbitrary-precision arithmetic (a derived
 * type's range is not enforced, as in Comunica); other numeric datatypes use JS
 * number parsing.
 */
export function numericValue(term: RdfLiteral): number | bigint | null {
  const datatype = term.datatype?.value;
  if (datatype === undefined || !NUMERIC_DATATYPES.has(datatype)) {
    return null;
  }
  if (INTEGER_DATATYPES.has(datatype)) {
    try {
      return BigInt(term.value);
    } catch {
      return null;
    }
  }
  if (datatype === XSD_FLOAT || datatype === XSD_DOUBLE) {
    return doubleFromText(term.value);
  }
  const numeric = numberFromText(term.value);
  return Number.isNaN(numeric) ? null : numeric;
}

/**
 * compareNumericValues orders two numeric values, comparing BigInt pairs
 * exactly and everything else as Numbers. It returns NaN when either value is
 * NaN, so every ordering operator answers false, as XPath requires.
 */
export function compareNumericValues(
  a: number | bigint,
  b: number | bigint,
): number {
  if (typeof a === "bigint" && typeof b === "bigint") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const an = numberFromNumeric(a);
  const bn = numberFromNumeric(b);
  if (Number.isNaN(an) || Number.isNaN(bn)) {
    return NaN;
  }
  return an < bn ? -1 : an > bn ? 1 : 0;
}

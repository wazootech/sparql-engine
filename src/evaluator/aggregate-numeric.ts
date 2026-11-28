import type { RdfLiteral, RdfTerm } from "@/parser/rdf-terms.ts";
import {
  canonicalDouble,
  DataFactory,
  formatNumber,
  numberFromNumeric,
  numericValue,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
} from "@/term/mod.ts";
import {
  divideExactDecimal,
  formatExactDecimal,
  parseExactDecimal,
  sumExactDecimals,
} from "@/evaluator/exact-decimal.ts";
import type { ExactDecimal } from "@/evaluator/exact-decimal.ts";

const { literal, namedNode } = DataFactory;

export function sumAggregate(defined: RdfTerm[]): RdfTerm | undefined {
  if (defined.length === 0) {
    return integerLiteral(0);
  }
  let datatype = XSD_INTEGER;
  const nums: (number | bigint)[] = [];
  for (const value of defined) {
    if (value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    nums.push(numeric);
    const dt = value.datatype?.value ?? "";
    if (dt === XSD_DOUBLE) {
      datatype = XSD_DOUBLE;
    } else if (dt === XSD_FLOAT && datatype !== XSD_DOUBLE) {
      datatype = XSD_FLOAT;
    } else if (dt === XSD_DECIMAL && datatype === XSD_INTEGER) {
      datatype = XSD_DECIMAL;
    }
  }
  if (datatype === XSD_INTEGER && nums.every((n) => typeof n === "bigint")) {
    let total = 0n;
    for (const n of nums) {
      total += n as bigint;
    }
    return integerLiteral(total);
  }
  if (datatype === XSD_DECIMAL) {
    const exact = exactTotal(defined, nums);
    if (exact !== null) {
      return decimalLiteral(formatExactDecimal(exact));
    }
  }
  return numericLiteral(floatTotal(nums), datatype);
}

export function avgAggregate(defined: RdfTerm[]): RdfTerm | undefined {
  if (defined.length === 0) {
    return integerLiteral(0);
  }
  let datatype = XSD_DECIMAL;
  const nums: (number | bigint)[] = [];
  for (const value of defined) {
    if (value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    nums.push(numeric);
    const dt = value.datatype?.value ?? "";
    if (dt === XSD_DOUBLE) {
      datatype = XSD_DOUBLE;
    } else if (dt === XSD_FLOAT && datatype !== XSD_DOUBLE) {
      datatype = XSD_FLOAT;
    }
  }
  if (datatype === XSD_DECIMAL) {
    const exact = exactTotal(defined, nums);
    if (exact !== null) {
      return decimalLiteral(divideExactDecimal(exact, defined.length));
    }
  }
  return numericLiteral(floatTotal(nums) / defined.length, datatype);
}

export function integerLiteral(value: number | bigint): RdfLiteral {
  return literal(String(value), namedNode(XSD_INTEGER));
}

/**
 * exactTotal sums integer and decimal operands without rounding, so float
 * accumulation noise never leaks into a decimal result (1.0 + 2.2 + 3.5 + 2.2
 * + 2.2 must be "11.1"). It returns null when a decimal's lexical form is one
 * the exact parser does not read.
 */
function exactTotal(
  defined: RdfTerm[],
  nums: (number | bigint)[],
): ExactDecimal | null {
  const parts: ExactDecimal[] = [];
  for (let index = 0; index < nums.length; index++) {
    const numeric = nums[index];
    const part =
      typeof numeric === "bigint"
        ? { significand: numeric, scale: 0 }
        : parseExactDecimal((defined[index] as RdfLiteral).value);
    if (part === null) {
      return null;
    }
    parts.push(part);
  }
  return sumExactDecimals(parts);
}

function floatTotal(nums: (number | bigint)[]): number {
  let total = 0;
  for (const n of nums) {
    total += numberFromNumeric(n);
  }
  return total;
}

/** An infinite decimal has no lexical form, so it is a type error (unbound). */
function numericLiteral(
  value: number,
  datatype: string,
): RdfLiteral | undefined {
  if (datatype === XSD_DOUBLE || datatype === XSD_FLOAT) {
    return literal(canonicalDouble(value), namedNode(datatype));
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return literal(formatNumber(value, datatype), namedNode(datatype));
}

function decimalLiteral(text: string): RdfLiteral {
  return literal(text, namedNode(XSD_DECIMAL));
}

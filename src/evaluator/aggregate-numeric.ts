import type * as rdfjs from "@rdfjs/types";
import {
  canonicalDouble,
  DataFactory,
  formatNumber,
  numericValue,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
} from "@/term/mod.ts";

const { literal, namedNode } = DataFactory;

export function sumAggregate(defined: rdfjs.Term[]): rdfjs.Term | undefined {
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
    return exactDecimalSum(defined);
  }
  let total = 0;
  for (const n of nums) {
    total += Number(n);
  }
  return numericLiteral(total, datatype);
}

export function avgAggregate(defined: rdfjs.Term[]): rdfjs.Term | undefined {
  if (defined.length === 0) {
    return integerLiteral(0);
  }
  let datatype = XSD_DECIMAL;
  let total = 0;
  for (const value of defined) {
    if (value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    total += Number(numeric);
    const dt = value.datatype?.value ?? "";
    if (dt === XSD_DOUBLE || dt === XSD_FLOAT) {
      datatype = XSD_DOUBLE;
    }
  }
  return numericLiteral(total / defined.length, datatype);
}

export function integerLiteral(value: number | bigint): rdfjs.Literal {
  return literal(String(value), namedNode(XSD_INTEGER));
}

function numericLiteral(
  value: number,
  datatype: string,
): rdfjs.Literal {
  const text = datatype === XSD_DOUBLE || datatype === XSD_FLOAT
    ? canonicalDouble(value)
    : formatNumber(value, datatype);
  return literal(text, namedNode(datatype));
}

/**
 * exactDecimalSum sums numeric literals exactly when the aggregate's result
 * datatype is xsd:decimal, so JS float accumulation noise never leaks into
 * the lexical result (1.0 + 2.2 + 3.5 + 2.2 + 2.2 must be "11.1", not
 * "11.100000000000001"). Each term parses to a BigInt significand and a
 * scale; scales align to the maximum and the sum renders with trailing
 * fractional zeros stripped.
 *
 * Prior art: fixed-point arithmetic on (BigInt significand, scale) pairs
 * — summing scaled integers instead of binary floats — avoids the
 * rounding error that Goldberg's analysis shows in naive floating-point
 * accumulation.
 * @see {@link https://doi.org/10.1145/103162.103163 Goldberg, "What Every Computer Scientist Should Know About Floating-Point Arithmetic," ACM Computing Surveys 23(1), 1991, pp. 5–48}
 */
function exactDecimalSum(defined: rdfjs.Term[]): rdfjs.Literal {
  let maxScale = 0;
  const parts: { significand: bigint; scale: number }[] = [];
  for (const value of defined) {
    const literalValue = value as rdfjs.Literal;
    const text = literalValue.value;
    const dot = text.indexOf(".");
    const scale = dot === -1 ? 0 : text.length - dot - 1;
    const digits = dot === -1 ? text : text.slice(0, dot) + text.slice(dot + 1);
    maxScale = Math.max(maxScale, scale);
    parts.push({ significand: BigInt(digits), scale });
  }
  let total = 0n;
  for (const part of parts) {
    total += part.significand * 10n ** BigInt(maxScale - part.scale);
  }
  return numericLiteralFromExactDecimal(total, maxScale);
}

/**
 * numericLiteralFromExactDecimal renders an exact decimal sum (a BigInt
 * significand plus a scale) as an xsd:decimal literal with trailing
 * fractional zeros stripped ("111"/1 -> "11.1", "32"/1 -> "3.2", "3"/1 ->
 * "3").
 */
function numericLiteralFromExactDecimal(
  total: bigint,
  scale: number,
): rdfjs.Literal {
  const negative = total < 0n;
  const absolute = (negative ? -total : total).toString().padStart(
    scale + 1,
    "0",
  );
  let text: string;
  if (scale === 0) {
    text = absolute;
  } else {
    const intPart = absolute.slice(0, absolute.length - scale);
    const fracPart = absolute.slice(absolute.length - scale).replace(
      /0+$/,
      "",
    );
    text = fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
  }
  if (negative) {
    text = "-" + text;
  }
  return literal(text, namedNode(XSD_DECIMAL));
}

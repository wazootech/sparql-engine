// Prototype: exact xsd:integer / xsd:decimal SUM without BigInt, using
// sign + magnitude digit strings. Matches aggregate.ts's exactDecimalSum /
// integer-SUM behavior byte for byte (canonical form, trailing fractional
// zeros stripped, negative handling), then benchmarks against the BigInt
// implementation on representative workloads.
//
// The point: scriptc's static tier rejects BigInt ("f64 is the one number
// type"); this layer is the "decimal-string arithmetic" escape hatch that
// preserves the differential-parity-pinned exact results.

export interface Decimal {
  negative: boolean;
  /** magnitude digits, no leading zeros, no sign, no point; "0" for zero. */
  digits: string;
  /** number of fractional digits. */
  scale: number;
}

const ZERO: Decimal = { negative: false, digits: "0", scale: 0 };

/** fromLexical parses an xsd:integer/xsd:decimal lexical form. */
export function fromLexical(lexical: string): Decimal {
  const text = lexical.trim();
  let negative = false;
  let rest = text;
  if (rest[0] === "+") {
    rest = rest.slice(1);
  } else if (rest[0] === "-") {
    negative = true;
    rest = rest.slice(1);
  }
  const dot = rest.indexOf(".");
  let intPart = dot === -1 ? rest : rest.slice(0, dot);
  const fracPart = dot === -1 ? "" : rest.slice(dot + 1);
  if (intPart === "") intPart = "0";
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, "") || "0";
  const scale = fracPart.length;
  if (digits === "0") return ZERO;
  return { negative, digits, scale };
}

/** normalize strips trailing fractional zeros (canonical form). */
function normalize(d: Decimal): Decimal {
  let { negative, digits, scale } = d;
  if (digits === "" || /^0+$/.test(digits)) return ZERO;
  while (scale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale--;
  }
  if (digits === "") return ZERO;
  return { negative, digits, scale };
}

/** magnitude add: aDigits + bDigits (no sign). */
function magAdd(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let carry = 0;
  let out = "";
  while (i >= 0 || j >= 0 || carry > 0) {
    const da = i >= 0 ? a.charCodeAt(i) - 48 : 0;
    const db = j >= 0 ? b.charCodeAt(j) - 48 : 0;
    const sum = da + db + carry;
    carry = sum >= 10 ? 1 : 0;
    out = String.fromCharCode(48 + (sum % 10)) + out;
    i--;
    j--;
  }
  return out;
}

/** magGt: aDigits > bDigits (magnitude comparison). */
function magGt(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/** magSub: aDigits - bDigits, requires a >= b (no sign). */
function magSub(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let borrow = 0;
  let out = "";
  while (i >= 0) {
    let da = a.charCodeAt(i) - 48 - borrow;
    const db = j >= 0 ? b.charCodeAt(j) - 48 : 0;
    borrow = 0;
    if (da < db) {
      da += 10;
      borrow = 1;
    }
    out = String.fromCharCode(48 + (da - db)) + out;
    i--;
    j--;
  }
  return out.replace(/^0+(?=\d)/, "") || "0";
}

/** add sums two exact decimals, preserving canonical form. */
export function add(a: Decimal, b: Decimal): Decimal {
  if (a.digits === "0") return b;
  if (b.digits === "0") return a;
  const scale = Math.max(a.scale, b.scale);
  const aDigits = a.digits + "0".repeat(scale - a.scale);
  const bDigits = b.digits + "0".repeat(scale - b.scale);
  let out: Decimal;
  if (a.negative === b.negative) {
    out = { negative: a.negative, digits: magAdd(aDigits, bDigits), scale };
  } else {
    if (magGt(aDigits, bDigits)) {
      out = { negative: a.negative, digits: magSub(aDigits, bDigits), scale };
    } else if (magGt(bDigits, aDigits)) {
      out = { negative: b.negative, digits: magSub(bDigits, aDigits), scale };
    } else {
      return ZERO;
    }
  }
  return normalize(out);
}

/** toString renders the canonical xsd:integer/xsd:decimal lexical form. */
export function toString(d: Decimal): string {
  d = normalize(d);
  const { negative, digits, scale } = d;
  if (digits === "0") return "0";
  const sign = negative ? "-" : "";
  if (scale === 0) return sign + digits;
  const intPart = digits.slice(0, digits.length - scale) || "0";
  const fracPart = digits.slice(digits.length - scale);
  return sign + intPart + "." + fracPart;
}

/** decimalSum sums lexical decimal/integer forms exactly, canonically. */
export function decimalSum(values: string[]): string {
  let acc = ZERO;
  for (const value of values) {
    acc = add(acc, fromLexical(value));
  }
  return toString(acc);
}

// ---------------------------------------------------------------------------
// Reference implementations mirroring aggregate.ts (BigInt path).
// ---------------------------------------------------------------------------

/** bigintDecimalSum mirrors exactDecimalSum's significand/scale alignment. */
export function bigintDecimalSum(values: string[]): string {
  let maxScale = 0;
  const parts: { significand: bigint; scale: number }[] = [];
  for (const text of values) {
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
  const negative = total < 0n;
  const absolute = (negative ? -total : total).toString().padStart(
    maxScale + 1,
    "0",
  );
  let text: string;
  if (maxScale === 0) {
    text = absolute;
  } else {
    const intPart = absolute.slice(0, absolute.length - maxScale);
    const fracPart = absolute.slice(absolute.length - maxScale).replace(
      /0+$/,
      "",
    );
    text = fracPart.length === 0 ? intPart : `${intPart}.${fracPart}`;
  }
  return negative ? "-" + text : text;
}

/** bigintIntegerSum mirrors the xsd:integer SUM path (BigInt accumulation). */
export function bigintIntegerSum(values: string[]): string {
  let total = 0n;
  for (const v of values) {
    total += BigInt(v);
  }
  return total.toString();
}

/** stringIntegerSum mirrors the same path without BigInt. */
export function stringIntegerSum(values: string[]): string {
  let acc = ZERO;
  for (const v of values) {
    acc = add(acc, fromLexical(v));
  }
  return toString(acc);
}

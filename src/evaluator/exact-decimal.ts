/**
 * Exact decimal arithmetic for SUM and AVG: fixed-point arithmetic on (BigInt
 * significand, scale) pairs, which avoids the rounding error that Goldberg's
 * analysis shows in naive floating-point accumulation.
 * @see {@link https://doi.org/10.1145/103162.103163 Goldberg, "What Every Computer Scientist Should Know About Floating-Point Arithmetic," ACM Computing Surveys 23(1), 1991, pp. 5–48}
 */

/** ExactDecimal is a decimal held without rounding: significand × 10^-scale. */
export interface ExactDecimal {
  significand: bigint;
  scale: number;
}

const DECIMAL_FORM = /^([+-]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]+))?$/;

/** MAX_EXPONENT bounds the power of ten an exponent form may expand to. */
const MAX_EXPONENT = 400;

/** MAX_QUOTIENT_DIGITS bounds the search for a quotient that terminates. */
const MAX_QUOTIENT_DIGITS = 20;

/**
 * parseExactDecimal reads a numeric lexical form, ignoring surrounding
 * whitespace and accepting an exponent as the numeric parser does. It returns
 * null for any other form, or for an exponent too large to expand.
 */
export function parseExactDecimal(text: string): ExactDecimal | null {
  const match = DECIMAL_FORM.exec(text.trim());
  if (match === null) {
    return null;
  }
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  if (whole === "" && fraction === "") {
    return null;
  }
  const exponent = match[4] === undefined ? 0 : parseInt(match[4], 10);
  if (Math.abs(exponent) > MAX_EXPONENT) {
    return null;
  }
  const magnitude = BigInt(whole + fraction);
  const significand = match[1] === "-" ? -magnitude : magnitude;
  const scale = fraction.length - exponent;
  if (scale >= 0) {
    return { significand, scale };
  }
  return { significand: significand * 10n ** BigInt(-scale), scale: 0 };
}

/** sumExactDecimals adds the parts after aligning them to the widest scale. */
export function sumExactDecimals(parts: ExactDecimal[]): ExactDecimal {
  let scale = 0;
  for (const part of parts) {
    scale = Math.max(scale, part.scale);
  }
  let significand = 0n;
  for (const part of parts) {
    significand += part.significand * 10n ** BigInt(scale - part.scale);
  }
  return { significand, scale };
}

/**
 * formatExactDecimal renders a decimal with trailing fractional zeros stripped
 * ("111"/1 -> "11.1", "30"/1 -> "3").
 */
export function formatExactDecimal(value: ExactDecimal): string {
  const negative = value.significand < 0n;
  const digits = (negative ? -value.significand : value.significand)
    .toString()
    .padStart(value.scale + 1, "0");
  const split = digits.length - value.scale;
  const whole = digits.slice(0, split);
  const fraction = digits.slice(split).replace(/0+$/, "");
  const text = fraction === "" ? whole : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

/**
 * divideExactDecimal divides by a positive count. A quotient that terminates is
 * returned exactly; any other is rounded to a double, the precision Comunica
 * reports.
 */
export function divideExactDecimal(value: ExactDecimal, count: number): string {
  const divisor = BigInt(count);
  let significand = value.significand;
  for (let extra = 0; extra <= MAX_QUOTIENT_DIGITS; extra++) {
    if (significand % divisor === 0n) {
      return formatExactDecimal({
        significand: significand / divisor,
        scale: value.scale + extra,
      });
    }
    significand *= 10n;
  }
  return String(parseFloat(formatExactDecimal(value)) / count);
}

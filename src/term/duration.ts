/**
 * duration.ts reads an xsd:duration lexical form as a comparable value.
 */

import { numberFromText } from "@/term/numeric.ts";
import type { TemporalValue } from "@/term/temporal.ts";

const DURATION_FORM =
  /^(-)?P(?:([0-9]+)Y)?(?:([0-9]+)M)?(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)(\.[0-9]+)?S)?)?$/;

/** durationValue reads an xsd:duration lexical form of any subtype. */
export function durationValue(text: string): TemporalValue | null {
  const match = DURATION_FORM.exec(text);
  if (match === null || text.endsWith("P") || text.endsWith("T")) {
    return null;
  }
  const part = (index: number): number => numberFromText(match[index] ?? "0");
  const sign = match[1] === undefined ? 1 : -1;
  const seconds = part(4) * 86400 + part(5) * 3600 + part(6) * 60 + part(7);
  const fraction = match[8] === undefined ? 0 : numberFromText(`0${match[8]}`);
  return {
    months: sign * (part(2) * 12 + part(3)),
    seconds: sign * seconds,
    fraction: sign * fraction,
    hasTimezone: false,
  };
}

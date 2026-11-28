/**
 * typed-value.ts compares the literals SPARQL compares by value besides
 * numbers and strings: booleans, dates, times and durations.
 */

import type { RdfLiteral } from "@/parser/rdf-terms.ts";
import { XSD, XSD_BOOLEAN, XSD_DATETIME } from "@/term/numeric.ts";
import { dateTimeValue, dateValue, timeValue } from "@/term/temporal.ts";
import { durationValue } from "@/term/duration.ts";
import type { TemporalValue } from "@/term/temporal.ts";

/** TypedValue is a literal's value together with the family it compares in. */
export interface TypedValue {
  /** family names the values that may be compared with each other. */
  family: string;

  /** subtype separates the duration types, which order only among themselves. */
  subtype: string;

  value: TemporalValue;
}

/** MAX_ZONE_SECONDS is the widest offset an unwritten timezone may stand for. */
const MAX_ZONE_SECONDS = 14 * 3600;

function plain(seconds: number): TemporalValue {
  return { months: 0, seconds, fraction: 0, hasTimezone: false };
}

function tagged(
  family: string,
  subtype: string,
  value: TemporalValue | null,
): TypedValue | null {
  return value === null ? null : { family, subtype, value };
}

/** typedValue reads a boolean or temporal literal, or null for any other. */
export function typedValue(literal: RdfLiteral): TypedValue | null {
  const datatype = literal.datatype?.value ?? "";
  const text = literal.value;
  if (datatype === XSD_BOOLEAN) {
    if (text === "true" || text === "1") {
      return tagged("boolean", "boolean", plain(1));
    }
    if (text === "false" || text === "0") {
      return tagged("boolean", "boolean", plain(0));
    }
    return null;
  }
  if (datatype === XSD_DATETIME || datatype === `${XSD}dateTimeStamp`) {
    return tagged("dateTime", "dateTime", dateTimeValue(text));
  }
  if (datatype === `${XSD}date`) {
    return tagged("date", "date", dateValue(text));
  }
  if (datatype === `${XSD}time`) {
    return tagged("time", "time", timeValue(text));
  }
  if (datatype === `${XSD}duration`) {
    return tagged("duration", "duration", durationValue(text));
  }
  if (datatype === `${XSD}yearMonthDuration`) {
    const value = durationValue(text);
    return value === null || value.seconds !== 0 || value.fraction !== 0
      ? null
      : tagged("duration", "yearMonth", value);
  }
  if (datatype === `${XSD}dayTimeDuration`) {
    const value = durationValue(text);
    return value === null || value.months !== 0
      ? null
      : tagged("duration", "dayTime", value);
  }
  return null;
}

/** sign orders two values by months, then seconds, then the fraction. */
function sign(a: TemporalValue, b: TemporalValue): number {
  const difference =
    a.months - b.months || a.seconds - b.seconds || a.fraction - b.fraction;
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

/**
 * typedValuesEqual answers `=` for two literals of one family, or null when
 * they are not both readable values of the same family. An instant with a
 * timezone never equals one without.
 */
export function typedValuesEqual(a: RdfLiteral, b: RdfLiteral): boolean | null {
  const left = typedValue(a);
  const right = typedValue(b);
  if (left === null || right === null || left.family !== right.family) {
    return null;
  }
  return (
    left.value.hasTimezone === right.value.hasTimezone &&
    sign(left.value, right.value) === 0
  );
}

/**
 * orderTypedValues answers `<` and its siblings: a negative, zero or positive
 * number, or undefined when the pair has no order. Following XML Schema, two
 * instants of which only one has a timezone are ordered only when they are
 * more than 14 hours apart.
 */
export function orderTypedValues(
  a: RdfLiteral,
  b: RdfLiteral,
): number | undefined {
  const left = typedValue(a);
  const right = typedValue(b);
  if (left === null || right === null || left.family !== right.family) {
    return undefined;
  }
  if (
    left.family === "duration" &&
    (left.subtype !== right.subtype || left.subtype === "duration")
  ) {
    return undefined;
  }
  if (left.value.hasTimezone !== right.value.hasTimezone) {
    const apart = Math.abs(left.value.seconds - right.value.seconds);
    if (apart <= MAX_ZONE_SECONDS) {
      return undefined;
    }
  }
  return sign(left.value, right.value);
}

/**
 * sortTypedValues is the total order ORDER BY, MIN and MAX use within one
 * family (an unwritten timezone reads as UTC), or null for any other pair.
 */
export function sortTypedValues(a: RdfLiteral, b: RdfLiteral): number | null {
  const left = typedValue(a);
  const right = typedValue(b);
  if (left === null || right === null || left.family !== right.family) {
    return null;
  }
  return sign(left.value, right.value);
}

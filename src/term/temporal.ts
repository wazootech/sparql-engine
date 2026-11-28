/**
 * temporal.ts reads the value of an xsd date, time or duration lexical form so
 * the value comparisons of SPARQL's operator mapping (XPath 2.0) can order
 * them. Instants are seconds on the UTC timeline.
 * @see {@link https://www.w3.org/TR/2010/REC-xpath-functions-20101214/ Malhotra, Melton & Walsh (eds.), "XQuery 1.0 and XPath 2.0 Functions and Operators (Second Edition)," W3C Recommendation, 2010}
 */

import { numberFromText } from "@/term/numeric.ts";

/** TemporalValue is the comparable value of a date, time or duration. */
export interface TemporalValue {
  /** months is the year-month part of a duration; 0 for an instant. */
  months: number;

  /** seconds is whole seconds: an instant on the UTC timeline, or a length. */
  seconds: number;

  /** fraction is the sub-second part, kept apart so it is not rounded away. */
  fraction: number;

  /** hasTimezone is false for an instant written without a timezone. */
  hasTimezone: boolean;
}

const ZONE = "(Z|[+-][0-9]{2}:[0-9]{2})?";
const DATE = "(-?[0-9]{4,})-([0-9]{2})-([0-9]{2})";
const TIME = "([0-9]{2}):([0-9]{2}):([0-9]{2})(\\.[0-9]+)?";

const DATE_TIME_FORM = new RegExp(`^${DATE}T${TIME}${ZONE}$`);
const DATE_FORM = new RegExp(`^${DATE}${ZONE}$`);
const TIME_FORM = new RegExp(`^${TIME}${ZONE}$`);
/** MONTH_LENGTHS holds the days of each month in a common year. */
const MONTH_LENGTHS: number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/** daysFromCivil counts the days from 1970-01-01 to a proleptic date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const marchMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * marchMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** dateDays validates a calendar date and returns its day number, or null. */
function dateDays(year: string, month: string, day: string): number | null {
  const y = numberFromText(year);
  const m = numberFromText(month);
  const d = numberFromText(day);
  if (m < 1 || m > 12 || d < 1) {
    return null;
  }
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const length = m === 2 && leap ? 29 : MONTH_LENGTHS[m - 1]!;
  return d > length ? null : daysFromCivil(y, m, d);
}

/** zoneSeconds returns a timezone's offset, or null when out of range. */
function zoneSeconds(zone: string | undefined): number | null {
  if (zone === undefined || zone === "Z") {
    return 0;
  }
  const hours = numberFromText(zone.slice(1, 3));
  const minutes = numberFromText(zone.slice(4, 6));
  if (hours > 14 || minutes > 59) {
    return null;
  }
  const offset = hours * 3600 + minutes * 60;
  return zone.startsWith("-") ? -offset : offset;
}

/** instant combines a day number, a time of day and a timezone. */
function instant(
  days: number,
  clock: number,
  fraction: string | undefined,
  zone: string | undefined,
): TemporalValue | null {
  const offset = zoneSeconds(zone);
  if (offset === null) {
    return null;
  }
  return {
    months: 0,
    seconds: days * 86400 + clock - offset,
    fraction: fraction === undefined ? 0 : numberFromText(`0${fraction}`),
    hasTimezone: zone !== undefined,
  };
}

/** clockSeconds validates a time of day; 24:00:00 is the end of the day. */
function clockSeconds(
  hours: string,
  minutes: string,
  seconds: string,
  fraction: string | undefined,
): number | null {
  const h = numberFromText(hours);
  const m = numberFromText(minutes);
  const s = numberFromText(seconds);
  const endOfDay =
    h === 24 &&
    m === 0 &&
    s === 0 &&
    numberFromText(`0${fraction ?? ""}`) === 0;
  if ((h > 23 && !endOfDay) || m > 59 || s > 59) {
    return null;
  }
  return h * 3600 + m * 60 + s;
}

/** dateTimeValue reads an xsd:dateTime lexical form. */
export function dateTimeValue(text: string): TemporalValue | null {
  const match = DATE_TIME_FORM.exec(text);
  if (match === null) {
    return null;
  }
  const days = dateDays(match[1]!, match[2]!, match[3]!);
  const clock = clockSeconds(match[4]!, match[5]!, match[6]!, match[7]);
  if (days === null || clock === null) {
    return null;
  }
  return instant(days, clock, match[7], match[8]);
}

/** dateValue reads an xsd:date lexical form as its starting instant. */
export function dateValue(text: string): TemporalValue | null {
  const match = DATE_FORM.exec(text);
  if (match === null) {
    return null;
  }
  const days = dateDays(match[1]!, match[2]!, match[3]!);
  return days === null ? null : instant(days, 0, undefined, match[4]);
}

/** timeValue reads an xsd:time lexical form. */
export function timeValue(text: string): TemporalValue | null {
  const match = TIME_FORM.exec(text);
  if (match === null) {
    return null;
  }
  const clock = clockSeconds(match[1]!, match[2]!, match[3]!, match[4]);
  return clock === null ? null : instant(0, clock % 86400, match[4], match[5]);
}

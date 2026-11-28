import assert from "node:assert/strict";
import { test } from "node:test";
import { dateTimeValue, dateValue, timeValue } from "@/term/temporal.ts";
import { durationValue } from "@/term/duration.ts";

test("dateTimeValue counts seconds on the UTC timeline", () => {
  assert.strictEqual(dateTimeValue("1970-01-01T00:00:00Z")!.seconds, 0);
  for (const text of [
    "2020-02-29T13:05:09Z",
    "2000-02-29T00:00:00Z",
    "1900-03-01T00:00:00Z",
    "2024-12-31T23:59:59Z",
    "1969-12-31T23:59:59Z",
  ]) {
    assert.strictEqual(
      dateTimeValue(text)!.seconds,
      Date.parse(text) / 1000,
      text,
    );
  }
  assert.strictEqual(
    dateTimeValue("2020-01-01T01:00:00+01:00")!.seconds,
    dateTimeValue("2019-12-31T16:00:00-08:00")!.seconds,
  );
});

test("dateTimeValue keeps the fraction and the timezone flag", () => {
  const value = dateTimeValue("2020-01-01T00:00:00.000000001")!;
  assert.strictEqual(value.fraction, 1e-9);
  assert.strictEqual(value.hasTimezone, false);
  assert.strictEqual(
    dateTimeValue("2020-01-01T00:00:00+00:00")!.hasTimezone,
    true,
  );
});

test("24:00:00 is the start of the next day and nothing later", () => {
  assert.strictEqual(
    dateTimeValue("2020-01-01T24:00:00Z")!.seconds,
    dateTimeValue("2020-01-02T00:00:00Z")!.seconds,
  );
  for (const text of [
    "2020-01-01T24:00:01Z",
    "2020-01-01T24:01:00Z",
    "2020-01-01T24:00:00.5Z",
  ]) {
    assert.strictEqual(dateTimeValue(text), null, text);
  }
});

test("extreme years order correctly", () => {
  const years = ["-0001", "0001", "9999", "10000"].map(
    (year) => dateTimeValue(`${year}-01-01T00:00:00Z`)!.seconds,
  );
  assert.deepStrictEqual(
    [...years].sort((a, b) => a - b),
    years,
  );
});

test("impossible and malformed instants have no value", () => {
  for (const text of [
    "2019-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2020-04-31T00:00:00Z",
    "2020-00-01T00:00:00Z",
    "2020-13-01T00:00:00Z",
    "2020-01-00T00:00:00Z",
    "2020-01-01T25:00:00Z",
    "2020-01-01T00:60:00Z",
    "2020-01-01T00:00:60Z",
    "2020-01-01T00:00:00+15:00",
    "2020-01-01T00:00:00+01:60",
    "2020-01-01",
    "bad",
    " 2020-01-01T00:00:00Z",
  ]) {
    assert.strictEqual(dateTimeValue(text), null, text);
  }
  assert.strictEqual(dateValue("2019-02-29"), null);
  assert.strictEqual(dateValue("2020-01-01T00:00:00"), null);
  assert.strictEqual(dateValue("2020-01-01+15:00"), null);
  assert.strictEqual(timeValue("24:00:01"), null);
  assert.strictEqual(timeValue("1:00:00"), null);
});

test("dates and times read their own forms", () => {
  assert.strictEqual(dateValue("1970-01-02Z")!.seconds, 86400);
  assert.strictEqual(dateValue("1970-01-02+01:00")!.seconds, 82800);
  assert.strictEqual(timeValue("01:00:00Z")!.seconds, 3600);
  assert.strictEqual(timeValue("24:00:00")!.seconds, 0);
});

test("durationValue separates months from seconds", () => {
  const value = durationValue("-P1Y2M3DT4H5M6.5S")!;
  assert.strictEqual(value.months, -14);
  assert.strictEqual(value.seconds, -(3 * 86400 + 4 * 3600 + 5 * 60 + 6));
  assert.strictEqual(value.fraction, -0.5);
  assert.strictEqual(durationValue("PT24H")!.seconds, 86400);
  for (const text of ["P", "PT", "P1YT", "1Y", "P-1Y", "P1S", "PT1D"]) {
    assert.strictEqual(durationValue(text), null, text);
  }
});

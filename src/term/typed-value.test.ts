import assert from "node:assert/strict";
import { test } from "node:test";
import { DataFactory } from "@/term/public.ts";
import {
  orderTypedValues,
  sortTypedValues,
  typedValue,
  typedValuesEqual,
} from "@/term/typed-value.ts";

const { literal, namedNode } = DataFactory;
const typed = (value: string, type: string) =>
  literal(value, namedNode(`http://www.w3.org/2001/XMLSchema#${type}`));
const instant = (value: string) => typed(value, "dateTime");
const flag = (value: string) => typed(value, "boolean");

test("booleans compare by value in either spelling", () => {
  assert.strictEqual(typedValuesEqual(flag("1"), flag("true")), true);
  assert.strictEqual(typedValuesEqual(flag("0"), flag("true")), false);
  assert.ok(orderTypedValues(flag("false"), flag("1"))! < 0);
  assert.strictEqual(typedValue(flag("maybe")), null);
  assert.strictEqual(typedValuesEqual(flag("maybe"), flag("true")), null);
});

test("only one family compares", () => {
  const date = typed("2020-01-01", "date");
  const dateTime = instant("2020-01-01T00:00:00Z");
  assert.strictEqual(typedValuesEqual(date, dateTime), null);
  assert.strictEqual(orderTypedValues(date, dateTime), undefined);
  assert.strictEqual(sortTypedValues(date, dateTime), null);
  assert.strictEqual(typedValue(literal("2020-01-01T00:00:00Z")), null);
  const stamp = typed("2020-01-01T00:00:00Z", "dateTimeStamp");
  assert.strictEqual(typedValuesEqual(stamp, dateTime), true);
});

test("a written and an unwritten timezone order only beyond 14 hours", () => {
  const local = instant("2020-01-02T00:00:00");
  const near = instant("2020-01-02T14:00:00Z");
  const far = instant("2020-01-02T14:00:01Z");
  assert.strictEqual(
    typedValuesEqual(local, instant("2020-01-02T00:00:00Z")),
    false,
  );
  assert.strictEqual(orderTypedValues(local, near), undefined);
  assert.ok(orderTypedValues(local, far)! < 0);
  assert.ok(orderTypedValues(far, local)! > 0);
  // Sorting still needs an order: an unwritten timezone reads as UTC.
  assert.ok(sortTypedValues(local, near)! < 0);
  assert.strictEqual(
    typedValuesEqual(local, instant("2020-01-02T00:00:00")),
    true,
  );
});

test("fractions order instants that share a whole second", () => {
  const early = instant("2020-01-01T00:00:00.25Z");
  const late = instant("2020-01-01T00:00:00.5Z");
  assert.ok(orderTypedValues(early, late)! < 0);
  assert.strictEqual(orderTypedValues(early, early), 0);
});

test("durations order within a subtype only", () => {
  const year = typed("P1Y", "yearMonthDuration");
  const months = typed("P13M", "yearMonthDuration");
  const day = typed("P1D", "dayTimeDuration");
  assert.ok(orderTypedValues(year, months)! < 0);
  assert.strictEqual(orderTypedValues(year, day), undefined);
  assert.strictEqual(
    typedValuesEqual(day, typed("PT24H", "dayTimeDuration")),
    true,
  );
  const general = typed("P1Y", "duration");
  assert.strictEqual(orderTypedValues(general, general), undefined);
  assert.strictEqual(
    typedValuesEqual(general, typed("P12M", "duration")),
    true,
  );
  assert.strictEqual(typedValue(typed("P1D", "yearMonthDuration")), null);
  assert.strictEqual(typedValue(typed("P1M", "dayTimeDuration")), null);
});

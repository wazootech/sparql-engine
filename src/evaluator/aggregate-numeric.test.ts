import assert from "node:assert/strict";
import { test } from "node:test";
import { DataFactory } from "@/term/public.ts";
import { avgAggregate, sumAggregate } from "@/evaluator/aggregate-numeric.ts";

const { literal, namedNode } = DataFactory;
const xsd = "http://www.w3.org/2001/XMLSchema#";
const typed = (value: string, type: string) =>
  literal(value, namedNode(xsd + type));
const decimals = (...values: string[]) =>
  values.map((value) => typed(value, "decimal"));

function check(
  actual: ReturnType<typeof sumAggregate>,
  value: string,
  type: string,
): void {
  assert.ok(actual !== undefined && actual.termType === "Literal");
  assert.strictEqual(actual.value, value);
  assert.strictEqual(actual.datatype.value, xsd + type);
}

test("SUM of integers stays exact beyond 2^53", () => {
  const items = [typed("9007199254740993", "integer"), typed("1", "integer")];
  check(sumAggregate(items), "9007199254740994", "integer");
});

test("SUM and AVG promote float and double operands", () => {
  const float = typed("1.5", "float");
  const double = typed("1", "double");
  const integer = typed("1", "integer");
  check(sumAggregate([float, integer]), "2.5E0", "float");
  check(sumAggregate([integer, float]), "2.5E0", "float");
  check(sumAggregate([double, float]), "2.5E0", "double");
  check(sumAggregate([float, double]), "2.5E0", "double");
  check(avgAggregate([float, float]), "1.5E0", "float");
  check(avgAggregate([float, double]), "1.25E0", "double");
  check(avgAggregate([double, float]), "1.25E0", "double");
});

test("SUM keeps float when a decimal follows", () => {
  const mixed = [typed("1.5", "float"), typed("1", "decimal")];
  check(sumAggregate(mixed), "2.5E0", "float");
});

test("SUM of decimals avoids float accumulation noise", () => {
  check(
    sumAggregate(decimals("1.0", "2.2", "3.5", "2.2", "2.2")),
    "11.1",
    "decimal",
  );
});

test("SUM of decimals renders sign, scale and zeros exactly", () => {
  const sum = (...values: string[]) => sumAggregate(decimals(...values));
  check(sum("-1.5", "-0.25"), "-1.75", "decimal");
  check(sum("-0.5", "0.25"), "-0.25", "decimal");
  check(sum("0.5", "-0.5"), "0", "decimal");
  check(sum("0.02", "0.03"), "0.05", "decimal");
  check(sum("1.050", "0"), "1.05", "decimal");
  check(sum("0.100", "0"), "0.1", "decimal");
  check(sum("1.50", "1.50"), "3", "decimal");
  check(sum("2", "3"), "5", "decimal");
  check(sum("-2", "-3"), "-5", "decimal");
  check(sum("+.5", "1."), "1.5", "decimal");
  check(
    sumAggregate([typed("10", "integer"), typed("0.5", "decimal")]),
    "10.5",
    "decimal",
  );
});

test("SUM reads padded and exponent decimal forms without shifting digits", () => {
  const sum = (...values: string[]) => sumAggregate(decimals(...values));
  check(sum(" 1.5 ", "1.0"), "2.5", "decimal");
  check(sum("1e5", "1.0"), "100001", "decimal");
  check(sum("15E-1", "1"), "2.5", "decimal");
});

test("SUM and AVG never throw on a form the exact parser does not read", () => {
  check(sumAggregate(decimals("0x10", "1")), "17", "decimal");
  check(sumAggregate(decimals("", "1")), "1", "decimal");
  check(avgAggregate(decimals("0x10", "2")), "9", "decimal");
  assert.strictEqual(sumAggregate(decimals("Infinity", "1")), undefined);
  assert.strictEqual(avgAggregate(decimals("Infinity", "1")), undefined);
  assert.strictEqual(sumAggregate(decimals("1e999999999")), undefined);
});

test("AVG divides the exact total", () => {
  const average = (...values: string[]) => avgAggregate(decimals(...values));
  check(average("1.1", "2.2"), "1.65", "decimal");
  check(average("0.1", "0.2", "0.3"), "0.2", "decimal");
  check(average("-1.5", "-0.25"), "-0.875", "decimal");
  check(average("1", "2", "2"), "1.6666666666666667", "decimal");
  const big = typed("9007199254740993", "integer");
  check(avgAggregate([big, big]), "9007199254740993", "decimal");
});

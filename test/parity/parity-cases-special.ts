import type { ParityTestCase } from "./parity-harness.ts";

const xsd = "http://www.w3.org/2001/XMLSchema#";
const typed = (value: string, type: string) => `"${value}"^^<${xsd}${type}>`;
const double = (value: string) => typed(value, "double");
const cast = (type: string, operand: string) => `<${xsd}${type}>(${operand})`;

/** bound builds a case that evaluates one expression per projected variable. */
function bound(name: string, expressions: string[]): ParityTestCase {
  const binds = expressions
    .map((expression, index) => `BIND(${expression} AS ?v${index})`)
    .join(" ");
  const variables = expressions.map((_, index) => `?v${index}`).join(" ");
  return {
    name,
    kind: "select",
    query: `SELECT ${variables} WHERE { ${binds} }`,
    quads: [],
  };
}

export const specialCases: ParityTestCase[] = [
  bound("special values - comparison", [
    `${double("INF")} > 1`,
    `${double("-INF")} < 1`,
    `${double("+INF")} > 1`,
    `${double("NaN")} = ${double("NaN")}`,
    `${double("NaN")} != ${double("NaN")}`,
    `${double("NaN")} < 1`,
    `${double("NaN")} >= 1`,
  ]),
  bound("special values - arithmetic and division by zero", [
    `${double("INF")} + 1`,
    `${double("INF")} - ${double("INF")}`,
    `${double("NaN")} * 2`,
    "1.0e0 / 0",
    "-1.0e0 / 0",
    "0.0e0 / 0",
    `${typed("1", "float")} / 0`,
    "1 / 0",
    "1.5 / 0.0",
  ]),
  bound("special values - functions", [
    `ABS(${double("-INF")})`,
    `ROUND(${double("NaN")})`,
    `isNumeric(${double("INF")})`,
    `isNumeric(${typed("NaN", "float")})`,
    `IF(${double("INF")}, 1, 2)`,
    `IF(${double("NaN")}, 1, 2)`,
  ]),
  bound("special values - casts", [
    cast("double", '"INF"'),
    cast("double", '"-INF"'),
    cast("double", '"NaN"'),
    cast("float", '"INF"'),
    cast("boolean", double("NaN")),
    cast("boolean", double("INF")),
    cast("string", double("INF")),
    cast("integer", double("INF")),
    cast("decimal", double("NaN")),
  ]),
  bound("effective boolean value - terms with and without one", [
    `IF(${typed("1", "boolean")}, 1, 2)`,
    `IF(<urn:x>, 1, 2)`,
    `!<urn:x>`,
    `<urn:x> && true`,
    `<urn:x> || true`,
  ]),
  bound("casts - invalid operands are unbound", [
    cast("boolean", typed("maybe", "boolean")),
    cast("integer", typed("maybe", "boolean")),
    cast("double", '""@fr'),
    cast("double", '"1"@fr'),
    cast("integer", '"1"@fr'),
    cast("dateTime", typed("bad", "dateTime")),
    cast("dateTime", '"2020-02-30T00:00:00Z"'),
    `TZ(${typed("bad", "dateTime")})`,
    'MD5("a"@en)',
  ]),
  bound("casts - values", [
    cast("integer", '"+5"'),
    cast("integer", '" 5 "'),
    cast("integer", "1.9"),
    cast("double", typed("1", "boolean")),
    cast("dateTime", typed("2020-01-01", "date")),
    cast("dateTime", '"2020-01-01T00:00:00Z"'),
  ]),
  bound("STR returns the lexical form", [
    `STR(${typed("05", "integer")})`,
    "STR(2.50)",
    "STR(1.0e0)",
    `STR(${double("INF")})`,
    "STR(true)",
    `STR(${typed("maybe", "boolean")})`,
    `STR(${typed("2020-01-01T00:00:00Z", "dateTime")})`,
    'STR("x"^^<urn:custom>)',
  ]),
  {
    name: "special values - aggregates",
    kind: "select",
    query:
      `SELECT (SUM(?x) AS ?sum) (AVG(?x) AS ?avg) ` +
      `WHERE { VALUES ?x { 1 ${double("INF")} } }`,
    quads: [],
  },
];

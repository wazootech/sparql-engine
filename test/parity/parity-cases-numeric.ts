import type { ParityTestCase } from "./parity-harness.ts";

const xsd = "http://www.w3.org/2001/XMLSchema#";
const typed = (value: string, type: string) => `"${value}"^^<${xsd}${type}>`;
const int = (value: string) => typed(value, "int");

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

/** ordered builds a case whose row order is part of the contract. */
function ordered(name: string, query: string): ParityTestCase {
  return { name, kind: "select", query, quads: [], orderSensitive: true };
}

const DERIVED_TYPES = [
  "nonPositiveInteger",
  "negativeInteger",
  "long",
  "int",
  "short",
  "byte",
  "nonNegativeInteger",
  "unsignedLong",
  "unsignedInt",
  "unsignedShort",
  "unsignedByte",
  "positiveInteger",
];

/** derivedValues is a VALUES clause holding 10 and 9 of one derived type. */
const derivedValues = (type: string) =>
  `VALUES ?x { ${typed("10", type)} ${typed("9", type)} }`;

/** averaged builds a SUM and AVG case over one VALUES list. */
function aggregated(name: string, values: string[]): ParityTestCase {
  return {
    name: `SUM and AVG - ${name}`,
    kind: "select",
    query:
      "SELECT (SUM(?x) AS ?sum) (AVG(?x) AS ?avg) " +
      `WHERE { VALUES ?x { ${values.join(" ")} } }`,
    quads: [],
  };
}

const decimal = (value: string) => typed(value, "decimal");
const float = (value: string) => typed(value, "float");

export const numericCases: ParityTestCase[] = [
  bound("derived integers - arithmetic promotes to integer", [
    `${int("5")} + ${typed("2", "byte")}`,
    `${int("5")} - 1`,
    `${int("5")} * ${typed("2", "long")}`,
    `${int("5")} / ${int("2")}`,
    `${int("5")} + 1.5`,
    `${typed("9223372036854775807", "long")} + 1`,
    `${typed("127", "byte")} + 1`,
  ]),
  bound("derived integers - rounding functions", [
    `ABS(${int("-5")})`,
    `CEIL(${int("5")})`,
    `FLOOR(${int("5")})`,
    `ROUND(${int("5")})`,
  ]),
  bound("derived integers - comparison, equality and identity", [
    `${int("9")} < ${int("10")}`,
    `${int("10")} >= 9`,
    `${int("05")} = 5`,
    `${int("5")} IN (5)`,
    `sameTerm(${int("5")}, 5)`,
    `IF(${int("0")}, 1, 2)`,
    `SUBSTR("abcdef", ${int("2")})`,
  ]),
  bound(
    "derived integers - every derived type is numeric",
    DERIVED_TYPES.map((type) => `isNumeric(${typed("1", type)})`),
  ),
  bound("derived integers - casts", [
    `<${xsd}integer>(${int("5")})`,
    `<${xsd}decimal>(${int("5")})`,
    `<${xsd}double>(${int("5")})`,
    `<${xsd}boolean>(${int("0")})`,
    `<${xsd}string>(${int("05")})`,
  ]),
  bound("unary operators - literals and derived integers", [
    `-${int("5")}`,
    `+${int("5")}`,
    `-${typed("5", "unsignedInt")}`,
    `-(2 + 3)`,
    `-(1.5)`,
  ]),
  {
    name: "unary operators - variables in projection and filter",
    kind: "select",
    query:
      "SELECT ?x (-?x AS ?n) (+?x AS ?p) (?x - -?x AS ?d) " +
      "WHERE { VALUES ?x { 5 -2 } FILTER(-?x < 0) }",
    quads: [],
  },
  ...["int", "long", "unsignedByte", "positiveInteger"].flatMap((type) => [
    ordered(
      `derived integers - ORDER BY ${type} by value`,
      `SELECT ?x WHERE { ${derivedValues(type)} } ORDER BY ?x`,
    ),
    {
      name: `derived integers - aggregates over ${type}`,
      kind: "select" as const,
      query:
        "SELECT (MIN(?x) AS ?min) (MAX(?x) AS ?max) (SUM(?x) AS ?sum) " +
        `(AVG(?x) AS ?avg) WHERE { ${derivedValues(type)} }`,
      quads: [],
    },
  ]),
  aggregated("decimals without float noise", ["1.1", "2.2"]),
  aggregated("a quotient that does not terminate", ["1", "2", "2"]),
  aggregated("negative decimals", ["-1.5", "-0.25"]),
  aggregated("exponent form", [decimal("1e5"), decimal("1.0")]),
  aggregated("floats stay float", [float("1.5"), float("2.5")]),
  aggregated("float with integer", [float("1.5"), "1"]),
  aggregated("double with float", [typed("1", "double"), float("1.5")]),
  aggregated("derived integer with decimal", [int("2"), "0.5"]),
];

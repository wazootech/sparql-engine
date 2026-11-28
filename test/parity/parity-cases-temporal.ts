import type { ParityTestCase } from "./parity-harness.ts";

const xsd = "http://www.w3.org/2001/XMLSchema#";
const typed = (value: string, type: string) => `"${value}"^^<${xsd}${type}>`;
const instant = (value: string) => typed(value, "dateTime");

/** compared builds a case evaluating every comparison of each pair. */
function compared(name: string, pairs: [string, string][]): ParityTestCase {
  const operators = ["=", "!=", "<", ">", "<=", ">="];
  const expressions = pairs.flatMap(([left, right]) =>
    operators.map((operator) => `${left} ${operator} ${right}`),
  );
  const binds = expressions
    .map((expression, index) => `BIND(${expression} AS ?v${index})`)
    .join(" ");
  const variables = expressions.map((_, index) => `?v${index}`).join(" ");
  return {
    name: `value comparison - ${name}`,
    kind: "select",
    query: `SELECT ${variables} WHERE { ${binds} }`,
    quads: [],
  };
}

/** sorted builds ORDER BY, MIN and MAX cases over one value list. */
function sorted(name: string, values: string[]): ParityTestCase[] {
  const list = `VALUES ?x { ${values.join(" ")} }`;
  return [
    {
      name: `value ordering - ORDER BY ${name}`,
      kind: "select",
      query: `SELECT ?x WHERE { ${list} } ORDER BY ?x`,
      quads: [],
      orderSensitive: true,
    },
    {
      name: `value ordering - MIN and MAX of ${name}`,
      kind: "select",
      query: `SELECT (MIN(?x) AS ?min) (MAX(?x) AS ?max) WHERE { ${list} }`,
      quads: [],
    },
  ];
}

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

const ZONED = typed("2020-05-06+02:00", "date");
const PLAIN = typed("2020-05-06", "date");

export const temporalCases: ParityTestCase[] = [
  bound(
    "date components - functions over xsd:date",
    ["YEAR", "MONTH", "DAY", "HOURS", "TZ", "TIMEZONE"].flatMap((name) => [
      `${name}(${ZONED})`,
      `${name}(${PLAIN})`,
      `${name}(${typed("2020-02-30", "date")})`,
    ]),
  ),
  bound("date components - the xsd:date constructor", [
    `<${xsd}date>(${instant("2020-05-06T10:00:00+02:00")})`,
    `<${xsd}date>(${instant("2020-05-06T10:00:00")})`,
    `<${xsd}date>("2020-05-06")`,
    `<${xsd}date>(${ZONED})`,
    `<${xsd}date>("2020-02-30")`,
    `<${xsd}date>(1)`,
  ]),
  compared("dateTime across timezones", [
    [instant("2020-01-01T01:00:00+01:00"), instant("2020-01-01T00:00:00Z")],
    [instant("2019-12-31T16:00:00-08:00"), instant("2020-01-01T00:00:01Z")],
    [instant("2020-01-01T00:00:00.5Z"), instant("2020-01-01T00:00:00.25Z")],
    [instant("2020-01-01T24:00:00Z"), instant("2020-01-02T00:00:00Z")],
  ]),
  compared("date and time", [
    [typed("2020-01-01", "date"), typed("2020-01-02", "date")],
    [typed("2020-01-01+01:00", "date"), typed("2020-01-01Z", "date")],
    [typed("10:00:00Z", "time"), typed("11:00:00Z", "time")],
  ]),
  compared("durations", [
    [typed("P1D", "dayTimeDuration"), typed("PT24H", "dayTimeDuration")],
    [typed("P1Y", "yearMonthDuration"), typed("P13M", "yearMonthDuration")],
  ]),
  compared("booleans", [
    ["true", "false"],
    [typed("1", "boolean"), "true"],
    [typed("0", "boolean"), "true"],
  ]),
  ...sorted("dateTime across timezones", [
    instant("2020-01-01T10:00:00+05:00"),
    instant("2020-01-01T06:00:00Z"),
    instant("2019-12-31T23:00:00-08:00"),
  ]),
  ...sorted("dates", [
    typed("2020-01-02Z", "date"),
    typed("2020-01-01+01:00", "date"),
    typed("2020-01-01Z", "date"),
  ]),
  {
    name: "value comparison - FILTER and IN over dateTime variables",
    kind: "select",
    query:
      `SELECT ?x WHERE { VALUES ?x { ${instant("2019-06-01T00:00:00Z")} ` +
      `${instant("2021-06-01T00:00:00+02:00")} } ` +
      `FILTER(?x > ${instant("2020-01-01T00:00:00Z")} && ` +
      `?x IN (${instant("2021-05-31T22:00:00Z")})) }`,
    quads: [],
  },
];

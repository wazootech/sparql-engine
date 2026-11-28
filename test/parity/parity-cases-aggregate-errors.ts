import type { ParityTestCase } from "./parity-harness.ts";

/** aggregated builds a case evaluating every strict aggregate over one list. */
function aggregated(
  name: string,
  expression: string,
  values: string,
): ParityTestCase {
  const projections = ["SUM", "AVG", "MIN", "MAX"]
    .map((aggregate) => `(${aggregate}(${expression}) AS ?${aggregate})`)
    .join(" ");
  return {
    name: `aggregate errors - ${name}`,
    kind: "select",
    query: `SELECT ${projections} WHERE { VALUES ?n { ${values} } }`,
    quads: [],
  };
}

export const aggregateErrorCases: ParityTestCase[] = [
  aggregated("an expression that fails once", "1 / ?n", "1 0 2"),
  aggregated("an expression over an unbound row", "?n + 0", "1 UNDEF 2"),
  aggregated(
    "a branch that reads an unbound variable",
    "IF(?n = 0, ?gone, ?n)",
    "1 0 2",
  ),
  aggregated("a bare variable skips unbound rows", "?n", "1 UNDEF 2"),
  aggregated("an expression that never fails", "?n * 2", "1 2"),
  {
    name: "aggregate errors - GROUP_CONCAT over a failing expression",
    kind: "select",
    query:
      "SELECT (GROUP_CONCAT(STR(1 / ?n)) AS ?joined) " +
      "WHERE { VALUES ?n { 1 0 2 } }",
    quads: [],
  },
  {
    name: "aggregate errors - xsd:string of an invalid boolean is unbound",
    kind: "select",
    query:
      "SELECT (<http://www.w3.org/2001/XMLSchema#string>(" +
      '"maybe"^^<http://www.w3.org/2001/XMLSchema#boolean>) AS ?text) WHERE {}',
    quads: [],
  },
];

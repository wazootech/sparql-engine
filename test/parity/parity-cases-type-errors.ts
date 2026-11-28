import type { ParityTestCase } from "./parity-harness.ts";

const xsd = "http://www.w3.org/2001/XMLSchema#";
const typed = (value: string, type: string) => `"${value}"^^<${xsd}${type}>`;
const custom = (value: string) => `"${value}"^^<urn:t>`;

/** bound builds a case that evaluates one expression per projected variable. */
function bound(name: string, expressions: string[]): ParityTestCase {
  const binds = expressions
    .map((expression, index) => `BIND(${expression} AS ?v${index})`)
    .join(" ");
  const variables = expressions.map((_, index) => `?v${index}`).join(" ");
  return {
    name: `type errors - ${name}`,
    kind: "select",
    query: `SELECT ${variables} WHERE { ${binds} }`,
    quads: [],
  };
}

export const typeErrorCases: ParityTestCase[] = [
  bound("equality between literals no operator covers", [
    `${custom("a")} = ${custom("b")}`,
    `${custom("a")} != ${custom("b")}`,
    `${custom("a")} = ${custom("a")}`,
    `${custom("a")} = "a"`,
    `${custom("a")} = 1`,
    `${typed("abc", "integer")} = 1`,
    `${typed("abc", "integer")} != ${typed("abd", "integer")}`,
    '"a" = "a"@en',
    '"a"@en = "a"@fr',
    "1 = <urn:a>",
    "<urn:a> != <urn:b>",
  ]),
  bound("IN and NOT IN with an uncomparable candidate", [
    `${custom("a")} IN (${custom("b")})`,
    `${custom("a")} IN (${custom("b")}, ${custom("a")})`,
    `1 IN (${custom("x")}, 1)`,
    `1 IN (${custom("x")}, 2)`,
    `1 NOT IN (${custom("x")}, 2)`,
  ]),
  bound("string function argument compatibility", [
    'CONTAINS("abc", "b"@en)',
    'CONTAINS("abc"@en, "b"@fr)',
    'CONTAINS("abc"@en, "b"@en)',
    'CONTAINS("abc"@en, "b")',
    'STRSTARTS("abc", "a"@en)',
    'STRENDS("abc"@en, "c"@fr)',
    'STRBEFORE("abc", "b"@en)',
    'STRAFTER("abc"@en, "b"@fr)',
    'STRAFTER("abc"@en, "b"@EN)',
  ]),
  bound("language-tagged patterns, ranges and tags are errors", [
    'REGEX("abc", "b"@en)',
    'REGEX("abc", "b", "i"@en)',
    'REGEX("abc"@en, "b")',
    'REPLACE("abc", "b"@en, "x")',
    'REPLACE("abc", "b", "x"@en)',
    'LANGMATCHES("en"@en, "en")',
    'LANGMATCHES("en", "en"@en)',
    'STRLANG("a", "en"@en)',
  ]),
  bound("SUBSTR positions are integers", [
    'SUBSTR("abcde", 2.0e0)',
    'SUBSTR("abcde", 1.5)',
    'SUBSTR("abcde", 2, 1.5)',
    'SUBSTR("abcde", 2)',
    'SUBSTR("abcde", -1, 3)',
  ]),
  {
    name: "type errors - FILTER drops rows whose comparison is an error",
    kind: "select",
    query:
      `SELECT ?x WHERE { VALUES ?x { 1 "a" <urn:a> ${custom("c")} } ` +
      `FILTER(?x != "a") }`,
    quads: [],
  },
];

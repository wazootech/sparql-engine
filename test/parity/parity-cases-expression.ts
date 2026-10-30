import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import { basicKnowledgeGraphQuads } from "./parity-fixtures.ts";
import {
  dt,
  exampleAlice,
  foafAge,
  foafKnows,
  foafName,
  xsdDateTime,
} from "./parity-vocab.ts";

const { namedNode, quad } = DataFactory;

export const expressionCases: ParityTestCase[] = [
  {
    name: "REGEX - match with case-insensitive flag",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(REGEX("abc", "^a", "i") AS ?v) }`,
    quads: [],
  },
  {
    name: "REGEX - no match and non-string argument",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(REGEX("abc", "^z") AS ?v) }`,
    quads: [],
  },
  {
    name: "REGEX - language-tagged argument matches",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(REGEX("abc"@en, "b") AS ?v) }`,
    quads: [],
  },
  {
    name: "REPLACE - plain, group reference, flags, language",
    kind: "select",
    query:
      `SELECT ?v WHERE { BIND(REPLACE("Abab"@en, "a(b)", "[$1]", "i") AS ?v) }`,
    quads: [],
  },
  {
    name: "REPLACE - no match returns the input unchanged",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(REPLACE("abc", "z", "X") AS ?v) }`,
    quads: [],
  },
  {
    name: "CONTAINS and STRSTARTS and STRENDS",
    kind: "select",
    query: `SELECT ?c ?s ?e WHERE { BIND(CONTAINS("abc", "b") AS ?c) ` +
      `BIND(STRSTARTS("abc", "a") AS ?s) BIND(STRENDS("abc", "c") AS ?e) }`,
    quads: [],
  },
  {
    name: "STRBEFORE and STRAFTER keep the language tag",
    kind: "select",
    query: `SELECT ?b ?a WHERE { BIND(STRBEFORE("abc"@en, "b") AS ?b) ` +
      `BIND(STRAFTER("abc"@en, "b") AS ?a) }`,
    quads: [],
  },
  {
    name: "STRBEFORE and STRAFTER absent needle yield the empty string",
    kind: "select",
    query: `SELECT ?b ?a WHERE { BIND(STRBEFORE("abc", "z") AS ?b) ` +
      `BIND(STRAFTER("abc", "z") AS ?a) }`,
    quads: [],
  },
  {
    name: "LANG of language-tagged and plain literals",
    kind: "select",
    query: `SELECT ?l1 ?l2 WHERE { BIND(LANG("abc"@en) AS ?l1) ` +
      `BIND(LANG("abc") AS ?l2) }`,
    quads: [],
  },
  {
    name: "LANGMATCHES - basic, range, wildcard, negative, case",
    kind: "select",
    query: `SELECT ?a ?b ?c ?d ?e WHERE { ` +
      `BIND(LANGMATCHES("en", "en") AS ?a) ` +
      `BIND(LANGMATCHES("en-US", "en") AS ?b) ` +
      `BIND(LANGMATCHES("", "*") AS ?c) ` +
      `BIND(LANGMATCHES("en", "en-US") AS ?d) ` +
      `BIND(LANGMATCHES("EN-us", "en") AS ?e) }`,
    quads: [],
  },
  {
    name: "COALESCE skips unbound and erroring arguments",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(COALESCE(?missing, 1/0, "x") AS ?v) }`,
    quads: [],
  },
  {
    name: "IF true and false branches",
    kind: "select",
    query: `SELECT ?t ?f WHERE { BIND(IF(true, 1, 2) AS ?t) ` +
      `BIND(IF(false, 1, 2) AS ?f) }`,
    quads: [],
  },
  {
    name: "IN - hit, miss, error after a hit, empty list",
    kind: "select",
    query: `SELECT ?a ?b ?c ?d WHERE { ` +
      `BIND(1 IN (1, 2, 3) AS ?a) ` +
      `BIND(4 IN (1, 2, 3) AS ?b) ` +
      `BIND(1 IN (1, ?missing) AS ?c) ` +
      `BIND(1 IN () AS ?d) }`,
    quads: [],
  },
  {
    name: "NOT IN",
    kind: "select",
    query: `SELECT ?v WHERE { BIND(4 NOT IN (1, 2, 3) AS ?v) }`,
    quads: [],
  },
  {
    name: "SAMETERM term identity",
    kind: "select",
    query: `SELECT ?a ?b WHERE { BIND(SAMETERM(1, 1) AS ?a) ` +
      `BIND(SAMETERM(1, "1") AS ?b) }`,
    quads: [],
  },
  {
    name: "ABS preserves the numeric datatype",
    kind: "select",
    query: `SELECT ?i ?d ?x WHERE { BIND(ABS(-2) AS ?i) ` +
      `BIND(ABS(-2.5) AS ?d) BIND(ABS(-2.5e0) AS ?x) }`,
    quads: [],
  },
  {
    name: "CEIL and FLOOR preserve the datatype",
    kind: "select",
    query: `SELECT ?c ?f ?ci WHERE { BIND(CEIL(2.5) AS ?c) ` +
      `BIND(FLOOR(2.5) AS ?f) BIND(CEIL(2) AS ?ci) }`,
    quads: [],
  },
  {
    name: "ROUND halves toward positive infinity, doubles canonicalize",
    kind: "select",
    query: `SELECT ?a ?b ?c ?d WHERE { BIND(ROUND(2.5) AS ?a) ` +
      `BIND(ROUND(-2.5) AS ?b) BIND(ROUND(-0.5) AS ?c) ` +
      `BIND(ROUND(2.5e0) AS ?d) }`,
    quads: [],
  },
  {
    name: "date components of an xsd:dateTime",
    kind: "select",
    query: `SELECT ?y ?m ?d ?h ?mi ?s ?tz WHERE { ` +
      `BIND(YEAR(${dt}) AS ?y) BIND(MONTH(${dt}) AS ?m) ` +
      `BIND(DAY(${dt}) AS ?d) BIND(HOURS(${dt}) AS ?h) ` +
      `BIND(MINUTES(${dt}) AS ?mi) BIND(SECONDS(${dt}) AS ?s) ` +
      `BIND(TIMEZONE(${dt}) AS ?tz) }`,
    quads: [],
  },
  {
    name: "TIMEZONE of UTC and of a timezone-less literal",
    kind: "select",
    query: `SELECT ?z ?n WHERE { ` +
      `BIND(TIMEZONE("2011-01-10T14:45:13.815Z"^^${xsdDateTime}) AS ?z) ` +
      `BIND(TIMEZONE("2011-01-10T14:45:13.815"^^${xsdDateTime}) AS ?n) }`,
    quads: [],
  },
  {
    name: "hash family digests",
    kind: "select",
    query: `SELECT ?m ?s1 ?s2 ?s3 ?s5 WHERE { ` +
      `BIND(MD5("abc") AS ?m) BIND(SHA1("abc") AS ?s1) ` +
      `BIND(SHA256("abc") AS ?s2) BIND(SHA384("abc") AS ?s3) ` +
      `BIND(SHA512("abc") AS ?s5) }`,
    quads: [],
  },
  {
    name: "TRIPLE builds an RDF-star term over bound variables",
    kind: "select",
    query: `SELECT ?t WHERE { ${exampleAlice} ${foafName} ?o ` +
      `BIND(TRIPLE(${exampleAlice}, ${foafName}, ?o) AS ?t) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SUBJECT, PREDICATE, OBJECT and isTRIPLE",
    kind: "select",
    query: `SELECT ?s ?p ?o ?i ?n WHERE { ` +
      `BIND(TRIPLE(<http://example.org/s>, <http://example.org/p>, "o") AS ?t) ` +
      `BIND(SUBJECT(?t) AS ?s) BIND(PREDICATE(?t) AS ?p) ` +
      `BIND(OBJECT(?t) AS ?o) BIND(isTRIPLE(?t) AS ?i) ` +
      `BIND(isTRIPLE("x") AS ?n) }`,
    quads: [],
  },
  {
    name: "EXISTS - correlated FILTER keeps only matching solutions",
    kind: "select",
    query: `SELECT ?person WHERE { ?person ${foafName} ?n ` +
      `FILTER EXISTS { ?person ${foafKnows} ?friend } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "EXISTS - NOT EXISTS keeps only non-matching solutions",
    kind: "select",
    query: `SELECT ?person WHERE { ?person ${foafName} ?n ` +
      `FILTER NOT EXISTS { ?person ${foafKnows} ?friend } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "EXISTS - nested EXISTS inside EXISTS",
    kind: "select",
    query: `SELECT ?person WHERE { ?person ${foafName} ?n ` +
      `FILTER EXISTS { ?person ${foafName} ?n1 ` +
      `FILTER EXISTS { ?person ${foafAge} ?a } } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "EXISTS - in projection and ORDER BY",
    kind: "select",
    query: `SELECT ?person (EXISTS { ?person ${foafKnows} ?f } AS ?e) ` +
      `WHERE { ?person ${foafName} ?n } ORDER BY ?person`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "EXISTS - inside OPTIONAL follows the left-join contract",
    kind: "select",
    query: `SELECT ?person ?f WHERE { ?person ${foafName} ?n ` +
      `OPTIONAL { ?person ${foafKnows} ?f ` +
      `FILTER EXISTS { ?f ${foafName} ?fn } } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "EXISTS - GRAPH ?g correlated with an outer binding",
    kind: "select",
    query: `SELECT ?s WHERE { ?s <http://example.org/p> ?g . ` +
      `FILTER EXISTS { GRAPH ?g { ?s2 <http://example.org/p> ` +
      `<http://example.org/o2> } } }`,
    quads: [
      quad(
        namedNode("http://example.org/s1"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/g1"),
      ),
      quad(
        namedNode("http://example.org/s2"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/o2"),
      ),
      quad(
        namedNode("http://example.org/s3"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/o2"),
        namedNode("http://example.org/g1"),
      ),
    ],
  },
];

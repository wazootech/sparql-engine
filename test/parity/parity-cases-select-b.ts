import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import { basicKnowledgeGraphQuads } from "./parity-fixtures.ts";
import { exampleAlice, foafAge, foafKnows, foafName } from "./parity-vocab.ts";

const { literal, namedNode, quad } = DataFactory;
export const selectCasesB: ParityTestCase[] = [
  {
    name: "SELECT - ORDER BY DESC(STRLEN(?name)) expression",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name } ` +
      `ORDER BY DESC(STRLEN(?name))`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - ORDER BY STR(?name) normalizes language tags",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name } ` +
      `ORDER BY STR(?name)`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - OPTIONAL extends matches and keeps unmatched unbound",
    kind: "select",
    query: `SELECT ?person ?age WHERE { ?person ${foafName} ?name ` +
      `OPTIONAL { ?person ${foafAge} ?age } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - OPTIONAL with an inner FILTER drops the failed join",
    kind: "select",
    query: `SELECT ?person ?age WHERE { ?person ${foafName} ?name ` +
      `OPTIONAL { ?person ${foafAge} ?age FILTER(?age > 28) } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - OPTIONAL FILTER referencing an outer variable",
    kind: "select",
    query: `SELECT ?person ?age WHERE { ?person ${foafName} ?name ` +
      `OPTIONAL { ?person ${foafAge} ?age FILTER(?person = ${exampleAlice}) } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - MINUS eliminates solutions sharing a variable",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name ` +
      `MINUS { ?person ${foafAge} ?age } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - MINUS with no shared variables keeps every solution",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name ` +
      `MINUS { ?x ${foafKnows} ?y } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - MINUS applies its own inner FILTER",
    kind: "select",
    query: `SELECT ?person WHERE { ?person ${foafName} ?name ` +
      `MINUS { ?person ${foafAge} ?age FILTER(?age > 28) } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - nested OPTIONAL inside OPTIONAL",
    kind: "select",
    query: `SELECT ?person ?friend WHERE { ?person ${foafName} ?name ` +
      `OPTIONAL { ?person ${foafKnows} ?friend ` +
      `OPTIONAL { ?friend ${foafName} ?friendName } } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UNION combines branch solutions as a multiset",
    kind: "select",
    query: `SELECT ?person WHERE { { ?person ${foafName} ?n } ` +
      `UNION { ?person ${foafAge} ?a } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UNION branches binding different variables",
    kind: "select",
    query:
      `SELECT ?n ?a WHERE { { ?s ${foafName} ?n } UNION { ?s ${foafAge} ?a } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UNION of identical branches doubles every solution",
    kind: "select",
    query: `SELECT ?person WHERE { { ?person ${foafName} ?n } ` +
      `UNION { ?person ${foafName} ?n } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UNION with three branches",
    kind: "select",
    query: `SELECT ?person WHERE { { ?person ${foafName} ?n } ` +
      `UNION { ?person ${foafAge} ?a } ` +
      `UNION { ?person ${foafKnows} ?f } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UNION in a sequence joins with preceding patterns",
    kind: "select",
    query: `SELECT ?person ?name ?age WHERE { ?person ${foafName} ?name . ` +
      `{ ?person ${foafName} ?n2 } UNION { ?person ${foafAge} ?age } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - UCASE and LCASE preserve language tags in projections",
    kind: "select",
    query: `SELECT ?person (UCASE(?name) AS ?upper) (LCASE(?name) AS ?lower) ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - SUBSTR projection with start and length",
    kind: "select",
    query: `SELECT ?person (SUBSTR(?name, 2, 3) AS ?mid) ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - CONCAT projection",
    kind: "select",
    query: `SELECT ?person (CONCAT(?name, "!") AS ?greeting) ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - XSD value constructors in projections",
    kind: "select",
    query: `SELECT (xsd:integer("42") AS ?i) (xsd:double("5") AS ?d) ` +
      `(xsd:boolean(1) AS ?b) (xsd:decimal(3.5) AS ?dec) ` +
      `WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - STRDT and STRLANG projections",
    kind: "select",
    query: `SELECT (STRDT("x", <http://example.org/t>) AS ?t) ` +
      `(STRLANG("hello", "en") AS ?sl) ` +
      `WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "VALUES - post-query VALUES restricts solutions (values01)",
    kind: "select",
    query: `SELECT ?book ?title WHERE { ?book ${foafName} ?title } ` +
      `VALUES (?book) { (<http://example.org/book/book1>) }`,
    quads: [
      quad(
        namedNode("http://example.org/book/book1"),
        namedNode("http://example.org/name"),
        literal("SPARQL Tutorial"),
      ),
      quad(
        namedNode("http://example.org/book/book2"),
        namedNode("http://example.org/name"),
        literal("The Semantic Web"),
      ),
    ],
  },
  {
    name: "VALUES - post-query VALUES with UNDEF row keeps all solutions",
    kind: "select",
    query: `SELECT ?book ?title WHERE { ?book ${foafName} ?title } ` +
      `VALUES (?book) { (UNDEF) }`,
    quads: [
      quad(
        namedNode("http://example.org/book/book1"),
        namedNode("http://example.org/name"),
        literal("SPARQL Tutorial"),
      ),
      quad(
        namedNode("http://example.org/book/book2"),
        namedNode("http://example.org/name"),
        literal("The Semantic Web"),
      ),
    ],
  },
  {
    name: "VALUES - post-query VALUES extends solutions with a fresh variable",
    kind: "select",
    query: `SELECT ?book ?tag WHERE { ?book ${foafName} ?title } ` +
      `VALUES (?tag) { (<http://example.org/tag/new>) }`,
    quads: [
      quad(
        namedNode("http://example.org/book/book1"),
        namedNode("http://example.org/name"),
        literal("SPARQL Tutorial"),
      ),
    ],
  },
];

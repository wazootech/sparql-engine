import type { ParityTestCase } from "./parity-harness.ts";
import {
  basicKnowledgeGraphQuads,
  fromDatasetQuads,
  namedGraphQuads,
  pathGraphQuads,
} from "./parity-fixtures.ts";
import {
  exampleAlice,
  exampleCarol,
  exampleNobody,
  foafAge,
  foafKnows,
  foafName,
  pPred,
} from "./parity-vocab.ts";

export const askCases: ParityTestCase[] = [
  {
    name: "ASK - matching pattern",
    kind: "ask",
    query: `ASK WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "ASK - non-matching pattern",
    kind: "ask",
    query: `ASK WHERE { ${exampleAlice} ${foafKnows} ${exampleCarol} }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "ASK - join across two triple patterns",
    kind: "ask",
    query: `ASK WHERE { ${exampleAlice} ${foafKnows} ?friend . ` +
      `?friend ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "ASK - FILTER numeric comparison",
    kind: "ask",
    query: `ASK WHERE { ?person ${foafAge} ?age FILTER(?age > 25) }`,
    quads: basicKnowledgeGraphQuads,
  },
];

export const constructCases: ParityTestCase[] = [
  {
    name: "CONSTRUCT - template over variable bindings",
    kind: "construct",
    query: `CONSTRUCT { ?person <http://example.org/displayName> ?name } ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "CONSTRUCT - constant template",
    kind: "construct",
    query: `CONSTRUCT { ${exampleAlice} <http://example.org/type> ` +
      `<http://example.org/Person> } WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "CONSTRUCT - reversed edge from a join",
    kind: "construct",
    query:
      `CONSTRUCT { ?friend <http://example.org/knownBy> ${exampleAlice} } ` +
      `WHERE { ${exampleAlice} ${foafKnows} ?friend }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "CONSTRUCT - empty result",
    kind: "construct",
    query: `CONSTRUCT { ?person <http://example.org/type> ` +
      `<http://example.org/Person> } WHERE { ${exampleNobody} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
];

export const describeCases: ParityTestCase[] = [
  {
    name: "DESCRIBE - IRI resource: outgoing arcs only",
    kind: "describe",
    query: `DESCRIBE ${exampleAlice}`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DESCRIBE - variable bindings describe each resource",
    kind: "describe",
    query: `DESCRIBE ?person WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DESCRIBE - star describes bound variables of the WHERE",
    kind: "describe",
    query: `DESCRIBE * WHERE { ${exampleAlice} ${foafKnows} ?friend }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DESCRIBE - IRI with WHERE describes only the IRI",
    kind: "describe",
    query:
      `DESCRIBE ${exampleAlice} WHERE { ${exampleNobody} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DESCRIBE - unknown resource yields the empty graph",
    kind: "describe",
    query: `DESCRIBE ${exampleNobody}`,
    quads: basicKnowledgeGraphQuads,
  },
];

/**
 * wildcardCases covers SELECT * projection and the solution modifiers
 * (DISTINCT, LIMIT, OFFSET), plus VALUES, BIND, and every property path
 * form — each differential against Comunica.
 */
export const wildcardCases: ParityTestCase[] = [
  {
    name: "SELECT * - wildcard projects every bound variable",
    kind: "select",
    query: `SELECT * WHERE { ${exampleAlice} ${foafKnows} ?friend }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - VALUES block with duplicates and UNDEF",
    kind: "select",
    query: `SELECT ?s ?n WHERE { VALUES (?s ?n) ` +
      `{ (${exampleAlice} 1) (${exampleAlice} 1) (UNDEF 2) } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - VALUES block constrains a preceding BGP",
    kind: "select",
    query: `SELECT ?s ?n WHERE { ?s ${foafName} ?name . ` +
      `VALUES (?s ?n) { (${exampleAlice} 1) (${exampleCarol} 2) } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - BIND extends a solution",
    kind: "select",
    query: `SELECT ?s ?u WHERE { ?s ${foafName} ?name . BIND(?name AS ?u) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - BIND error leaves the variable unbound",
    kind: "select",
    query: `SELECT ?s ?u WHERE { ?s ${foafName} ?name . BIND(STR(?z) AS ?u) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - DISTINCT removes duplicate projected solutions",
    kind: "select",
    query: `SELECT DISTINCT ?o WHERE { ?s ${pPred} ?o } ORDER BY ?o`,
    quads: pathGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - REDUCED deduplicates duplicate projected solutions",
    kind: "select",
    query: `SELECT REDUCED ?o WHERE { ?s ${pPred} ?o } ORDER BY ?o`,
    quads: pathGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - LIMIT and OFFSET slice ordered results",
    kind: "select",
    query: `SELECT ?o WHERE { ?s ${pPred} ?o } ORDER BY ?o LIMIT 2 OFFSET 1`,
    quads: pathGraphQuads,
    orderSensitive: true,
  },
];

export const graphCases: ParityTestCase[] = [
  {
    name: "GRAPH - scopes patterns to a named graph",
    kind: "select",
    query: `SELECT ?s ?o WHERE { GRAPH <http://example.org/g1> { ` +
      `?s ${pPred} ?o } } ORDER BY ?o`,
    quads: namedGraphQuads,
    orderSensitive: true,
  },
  {
    name: "GRAPH - ?g enumerates named graphs and binds the variable",
    kind: "select",
    query: `SELECT ?g ?s WHERE { GRAPH ?g { ?s ${pPred} ?o } } ORDER BY ?g ?s`,
    quads: namedGraphQuads,
    orderSensitive: true,
  },
  {
    name: "GRAPH - missing graph returns nothing",
    kind: "select",
    query: `SELECT ?s ?o WHERE { GRAPH <http://example.org/zz> { ` +
      `?s ${pPred} ?o } }`,
    quads: namedGraphQuads,
  },
  {
    name: "GRAPH - joins with a preceding pattern",
    kind: "select",
    query: `SELECT ?s ?o WHERE { ?s ${pPred} ?o1 . ` +
      `GRAPH <http://example.org/g1> { ?s ${pPred} ?o } } ORDER BY ?s`,
    quads: namedGraphQuads,
    orderSensitive: true,
  },
];

export const fromCases: ParityTestCase[] = [
  {
    name: "FROM - scopes the default graph to one named graph",
    kind: "select",
    query: `SELECT ?s ?o FROM <http://example.org/g1> WHERE { ?s ` +
      `<http://example.org/p> ?o } ORDER BY ?s`,
    quads: fromDatasetQuads,
    orderSensitive: true,
  },
  {
    name: "FROM - a missing graph yields an empty result",
    kind: "select",
    query: `SELECT ?s ?o FROM <http://example.org/none> WHERE { ?s ` +
      `<http://example.org/p> ?o }`,
    quads: fromDatasetQuads,
  },
  {
    name: "FROM - multiple FROM graphs merge into the default graph",
    kind: "select",
    query:
      `SELECT ?s ?o FROM <http://example.org/g1> FROM <http://example.org/g2> ` +
      `WHERE { ?s <http://example.org/p> ?o } ORDER BY ?s`,
    quads: fromDatasetQuads,
    orderSensitive: true,
  },
  {
    name:
      "FROM - FROM with FROM NAMED keeps the default graph as the FROM graphs",
    kind: "select",
    query:
      `SELECT ?s ?o FROM <http://example.org/g1> FROM NAMED <http://example.org/g2> ` +
      `WHERE { ?s <http://example.org/p> ?o } ORDER BY ?s`,
    quads: fromDatasetQuads,
    orderSensitive: true,
  },
  {
    name: "FROM - CONSTRUCT template lands in the default graph",
    kind: "construct",
    query:
      `CONSTRUCT { ?s <http://example.org/q> ?o } FROM <http://example.org/g1> ` +
      `WHERE { ?s <http://example.org/p> ?o }`,
    quads: fromDatasetQuads,
  },
  {
    name: "FROM - ASK over a FROM graph",
    kind: "ask",
    query:
      `ASK FROM <http://example.org/g1> WHERE { ?s <http://example.org/p> ?o }`,
    quads: fromDatasetQuads,
  },
  {
    name: "FROM - ASK over a missing graph",
    kind: "ask",
    query:
      `ASK FROM <http://example.org/none> WHERE { ?s <http://example.org/p> ?o }`,
    quads: fromDatasetQuads,
  },
];

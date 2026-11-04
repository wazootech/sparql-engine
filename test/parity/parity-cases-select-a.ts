import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import { basicKnowledgeGraphQuads } from "./parity-fixtures.ts";
import {
  exampleAlice,
  exampleCarol,
  exampleDave,
  exampleNobody,
  exampleSelf,
  foafAge,
  foafKnows,
  foafName,
} from "./parity-vocab.ts";

const { namedNode, quad } = DataFactory;

export const selectCasesA: ParityTestCase[] = [
  {
    name: "SELECT - simple projection with string and language literals",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - bound subject pattern",
    kind: "select",
    query: `SELECT ?name WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - join across two triple patterns",
    kind: "select",
    query: `SELECT ?name WHERE { ${exampleAlice} ${foafKnows} ?friend . ` +
      `?friend ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - typed literal value",
    kind: "select",
    query: `SELECT ?age WHERE { ${exampleCarol} ${foafAge} ?age }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - empty result",
    kind: "select",
    query: `SELECT ?name WHERE { ${exampleNobody} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - unbound projected variable",
    kind: "select",
    query: `SELECT ?name WHERE { ${exampleAlice} ${foafKnows} ?friend }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - blank node value",
    kind: "select",
    query:
      `SELECT ?pet WHERE { ${exampleAlice} <http://example.org/pet> ?pet }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - repeated variable within a pattern",
    kind: "select",
    query: `SELECT ?who WHERE { ?who ${exampleSelf} ?who }`,
    quads: [
      quad(
        namedNode(exampleDave),
        namedNode("http://example.org/self"),
        namedNode(exampleDave),
      ),
    ],
  },
  {
    name: "SELECT - asymmetric pattern order (reorder must be neutral)",
    kind: "select",
    query:
      `SELECT ?s ?p ?o ?n WHERE { ?s ?p ?o . ${exampleAlice} ${foafName} ?n }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - join chain with reorder-sensitive pattern order",
    kind: "select",
    query: `SELECT ?s ?grand ?n WHERE { ?s ${foafKnows} ?friend . ` +
      `?grand ${foafName} ?n . ?friend ${foafKnows} ?grand }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - repeated variable through a join",
    kind: "select",
    query:
      `SELECT ?friend WHERE { <${exampleDave}> <http://example.org/knows> ?friend . ` +
      `?friend ${exampleSelf} ?friend }`,
    quads: [
      quad(
        namedNode(exampleDave),
        namedNode("http://example.org/knows"),
        namedNode(exampleDave),
      ),
      quad(
        namedNode(exampleDave),
        namedNode("http://example.org/self"),
        namedNode(exampleDave),
      ),
    ],
  },
  {
    name: "SELECT - repeated variable bound to an RDF-star triple term",
    kind: "select",
    query: `SELECT ?t ?src WHERE { ?t <http://example.org/source> ?src . ` +
      `?t <http://example.org/source> ?src }`,
    quads: [
      quad(
        quad(
          namedNode(exampleAlice),
          namedNode("http://example.org/knows"),
          namedNode(exampleCarol),
        ),
        namedNode("http://example.org/source"),
        namedNode(exampleAlice),
      ),
      quad(
        quad(
          namedNode(exampleAlice),
          namedNode("http://example.org/knows"),
          namedNode(exampleCarol),
        ),
        namedNode("http://example.org/source"),
        namedNode(exampleCarol),
      ),
    ],
  },
  {
    name: "SELECT - ORDER BY name ascending (mixed lang-tagged and plain)",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name } ` +
      `ORDER BY ?name`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - ORDER BY name descending",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name } ` +
      `ORDER BY DESC(?name)`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - ORDER BY age ascending (numeric)",
    kind: "select",
    query:
      `SELECT ?person ?age WHERE { ?person ${foafAge} ?age } ORDER BY ?age`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - ORDER BY age descending then name ascending",
    kind: "select",
    query: `SELECT ?person ?age ?name WHERE { ?person ${foafAge} ?age . ` +
      `?person ${foafName} ?name } ORDER BY DESC(?age) ?name`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - ORDER BY an unbound variable keeps evaluation order",
    kind: "select",
    query:
      `SELECT ?person ?name ?missing WHERE { ?person ${foafName} ?name } ` +
      `ORDER BY ?missing`,
    quads: basicKnowledgeGraphQuads,
    orderSensitive: true,
  },
  {
    name: "SELECT - FILTER numeric comparison",
    kind: "select",
    query: `SELECT ?person ?age WHERE { ?person ${foafAge} ?age ` +
      `FILTER(?age > 18) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - FILTER arithmetic with numeric promotion",
    kind: "select",
    query: `SELECT ?person ?age WHERE { ?person ${foafAge} ?age ` +
      `FILTER(?age / 2 > 10) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - FILTER string equality with lang-tagged literal",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name ` +
      `FILTER(?name = "Ethan") }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - FILTER STRLEN over mixed plain and lang-tagged literals",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name ` +
      `FILTER(STRLEN(?name) > 4) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "SELECT - FILTER BOUND of an unbound variable",
    kind: "select",
    query: `SELECT ?person ?name WHERE { ?person ${foafName} ?name ` +
      `FILTER(!BOUND(?missing)) }`,
    quads: basicKnowledgeGraphQuads,
  },
];

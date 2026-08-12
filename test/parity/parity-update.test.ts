import { assertUpdateParity } from "./parity-harness.ts";
import type { ParityUpdateCase } from "./parity-harness.ts";
import { basicKnowledgeGraphQuads } from "./parity-fixtures.ts";
import { DataFactory } from "n3";

const { literal, namedNode, quad } = DataFactory;

const foafName = "<http://xmlns.com/foaf/0.1/name>";
const foafAge = "<http://xmlns.com/foaf/0.1/age>";
const foafKnows = "<http://xmlns.com/foaf/0.1/knows>";
const exampleAlice = "<http://example.org/alice>";
const exampleBob = "<http://example.org/bob>";
const exampleCarol = "<http://example.org/carol>";
const exampleGraph = "<http://example.org/graph>";
const exampleNobody = "<http://example.org/nobody>";
const xsdInteger = "<http://www.w3.org/2001/XMLSchema#integer>";

const updateCases: ParityUpdateCase[] = [
  {
    name: "INSERT DATA - uris and literals",
    update: `INSERT DATA { ${exampleBob} ${foafName} "Bobby" . ` +
      `${exampleBob} ${foafAge} "31"^^${xsdInteger} . ` +
      `${exampleAlice} ${foafKnows} ${exampleBob} }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT DATA - fresh blank node, shared within the template",
    update: `INSERT DATA { _:pet <http://example.org/name> "Rex" . ` +
      `_:pet ${foafKnows} ${exampleBob} }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT DATA - into a named graph",
    update:
      `INSERT DATA { GRAPH ${exampleGraph} { ${exampleAlice} ${foafName} "Ali" } }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE DATA - removes existing quads",
    update: `DELETE DATA { ${exampleAlice} ${foafName} "Alice" . ` +
      `${exampleCarol} ${foafName} "Carol"@en }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE DATA - typed literal exact match",
    update: `DELETE DATA { ${exampleAlice} ${foafAge} "28"^^${xsdInteger} }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE DATA - nonexistent quad is a no-op",
    update: `DELETE DATA { ${exampleAlice} ${foafName} "Nobody" }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "Composite - INSERT DATA then DELETE DATA in one request",
    update: `INSERT DATA { ${exampleAlice} <http://example.org/temp> "x" } ; ` +
      `DELETE DATA { ${exampleBob} ${foafName} "Bob" }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT WHERE - instantiate template per solution",
    update: `INSERT { ${exampleBob} <http://example.org/saw> ?name } ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT WHERE - fresh blank node per solution",
    update: `INSERT { _:x <http://example.org/owns> ?name } ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT WHERE - empty WHERE result is a no-op",
    update:
      `INSERT { <http://example.org/x> <http://example.org/saw> ?name } ` +
      `WHERE { ${exampleNobody} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT WHERE - unbound template variable is skipped",
    update:
      `INSERT { <http://example.org/x> <http://example.org/p> ?unbound } ` +
      `WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "INSERT WHERE - into a named graph template",
    update: `INSERT { GRAPH ${exampleGraph} { ?person ${foafName} ?name } } ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE WHERE - shorthand removes matching quads",
    update: `DELETE WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE WHERE - join pattern",
    update: `DELETE WHERE { ${exampleAlice} ${foafKnows} ?friend . ` +
      `?friend ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE/INSERT - move quads to a new predicate",
    update: `DELETE { ?person ${foafName} ?name } ` +
      `INSERT { ?person <http://example.org/displayName> ?name } ` +
      `WHERE { ?person ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE/INSERT - delete with a constant template position",
    update: `DELETE { ${exampleAlice} ${foafName} ?name } ` +
      `INSERT { ${exampleBob} ${foafName} ?name } ` +
      `WHERE { ${exampleAlice} ${foafName} ?name }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE DATA - from a named graph",
    update: `DELETE DATA { GRAPH ${exampleGraph} { ` +
      `${exampleAlice} ${foafName} "Alice" } }`,
    quads: [
      ...basicKnowledgeGraphQuads,
      quad(
        namedNode("http://example.org/alice"),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal("Alice"),
        namedNode("http://example.org/graph"),
      ),
    ],
  },
  {
    name: "INSERT DATA - existing quads are idempotent",
    update: `INSERT DATA { ${exampleAlice} ${foafName} "Alice" . ` +
      `${exampleAlice} ${foafAge} "28"^^${xsdInteger} }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "Composite - three operations in one request",
    update: `INSERT DATA { ${exampleAlice} <http://example.org/temp> "x" } ; ` +
      `DELETE DATA { ${exampleBob} ${foafName} "Bob" } ; ` +
      `INSERT DATA { ${exampleCarol} <http://example.org/seen> "y" }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE/INSERT with FILTER in the WHERE clause",
    update: `DELETE { ?person ${foafName} ?name } ` +
      `INSERT { ?person <http://example.org/displayName> ?name } ` +
      `WHERE { ?person ${foafName} ?name FILTER(STRLEN(?name) > 3) }`,
    quads: basicKnowledgeGraphQuads,
  },
  {
    name: "DELETE/INSERT with WITH clause",
    update:
      `WITH ${exampleGraph} DELETE { ?s ${foafName} ?name } INSERT { ?s <http://example.org/display> ?name } WHERE { ?s ${foafName} ?name }`,
    quads: [
      quad(
        namedNode("http://example.org/alice"),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal("Alice"),
        namedNode("http://example.org/graph"),
      ),
    ],
  },
  {
    name: "DELETE/INSERT with USING clause",
    update:
      `DELETE { ?s ${foafName} ?name } USING ${exampleGraph} WHERE { ?s ${foafName} ?name }`,
    quads: [
      quad(
        namedNode("http://example.org/alice"),
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal("Alice"),
        namedNode("http://example.org/graph"),
      ),
    ],
  },
];

for (const testCase of updateCases) {
  Deno.test(`parity - update - ${testCase.name}`, async () => {
    await assertUpdateParity(testCase);
  });
}

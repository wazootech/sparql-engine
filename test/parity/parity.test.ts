import { assertEquals, assertMatch } from "@std/assert";
import { DataFactory } from "n3";
import { NativeSparqlEngine } from "@/native-sparql-engine.ts";
import { assertQueryParity } from "./parity-harness.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import { canonicalizeSparqlValue } from "@/term/mod.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "./parity-harness.ts";
import {
  basicKnowledgeGraphQuads,
  createQuadStore,
} from "./parity-fixtures.ts";

const { namedNode, quad } = DataFactory;

const foafName = "<http://xmlns.com/foaf/0.1/name>";
const foafKnows = "<http://xmlns.com/foaf/0.1/knows>";
const foafAge = "<http://xmlns.com/foaf/0.1/age>";
const exampleAlice = "<http://example.org/alice>";
const exampleCarol = "<http://example.org/carol>";
const exampleNobody = "<http://example.org/nobody>";
const exampleSelf = "<http://example.org/self>";
const exampleDave = "http://example.org/dave";

const selectCases: ParityTestCase[] = [
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
];

const askCases: ParityTestCase[] = [
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
];

const constructCases: ParityTestCase[] = [
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

const allCases: ParityTestCase[] = [
  ...selectCases,
  ...askCases,
  ...constructCases,
];

for (const testCase of allCases) {
  Deno.test(`parity - ${testCase.name}`, async () => {
    await assertQueryParity(testCase);
  });
}

Deno.test(
  "parity - known difference: Comunica prefixes blank node labels, native does not",
  async () => {
    const petQuery =
      `SELECT ?pet WHERE { ${exampleAlice} <http://example.org/pet> ?pet }`;

    const comunicaStore = createQuadStore(basicKnowledgeGraphQuads);
    const comunicaEngine = getComunicaEngine();
    const comunicaBindings = await runComunicaRawSelectBindings(
      comunicaEngine,
      petQuery,
      comunicaStore,
    );

    const nativeStore = createQuadStore(basicKnowledgeGraphQuads);
    const nativeEngine = new NativeSparqlEngine({ store: nativeStore });
    const nativeResult = await nativeEngine.execute({ query: petQuery });
    assertEquals(nativeResult.kind, "select");
    if (nativeResult.kind !== "select") {
      return;
    }

    // Comunica skolemizes blank nodes from query sources into a per-source
    // prefixed label ("bc_<sourceId>_<label>"); the native engine deliberately
    // returns the store's own label instead.
    assertMatch(comunicaBindings[0].pet.value, /^bc_\d+_pet-alice$/);
    assertEquals(nativeResult.data.results.bindings[0].pet.value, "pet-alice");

    // After stripping the cosmetic prefix, both normalize to the same term.
    assertEquals(
      JSON.stringify(canonicalizeComunicaTerm(comunicaBindings[0].pet)),
      JSON.stringify(
        canonicalizeSparqlValue(nativeResult.data.results.bindings[0].pet),
      ),
    );
  },
);

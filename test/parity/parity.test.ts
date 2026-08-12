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
      `FILTER(?name = "Alice") }`,
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
  {
    name: "ASK - FILTER numeric comparison",
    kind: "ask",
    query: `ASK WHERE { ?person ${foafAge} ?age FILTER(?age > 25) }`,
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

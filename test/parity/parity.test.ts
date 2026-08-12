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
  aggregateQuads,
  basicKnowledgeGraphQuads,
  createQuadStore,
  namedGraphQuads,
  pathGraphQuads,
} from "./parity-fixtures.ts";

const { literal, namedNode, quad } = DataFactory;

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

const path = (id: string) => `<http://example.org/${id}>`;
const pPred = path("p");
const qPred = path("q");

/**
 * wildcardCases covers SELECT * projection and the solution modifiers
 * (DISTINCT, LIMIT, OFFSET), plus VALUES, BIND, and every property path
 * form — each differential against Comunica.
 */
const wildcardCases: ParityTestCase[] = [
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
    name: "SELECT - LIMIT and OFFSET slice ordered results",
    kind: "select",
    query: `SELECT ?o WHERE { ?s ${pPred} ?o } ORDER BY ?o LIMIT 2 OFFSET 1`,
    quads: pathGraphQuads,
    orderSensitive: true,
  },
];

const pathCases: ParityTestCase[] = [
  {
    name: "path - inverse ^ reverses an edge",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x ^${pPred} ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - sequence / composes two predicates",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x ${pPred}/${qPred} ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - alternative | unions with deduplication",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x ${pPred}|${qPred} ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - zero-or-one ? is reflexive",
    kind: "select",
    query: `SELECT ?y WHERE { ${path("a")} ${pPred}? ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - one-or-more + is transitive closure",
    kind: "select",
    query: `SELECT ?y WHERE { ${path("a")} ${pPred}+ ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - zero-or-more * is reflexive-transitive over all nodes",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x ${pPred}* ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - negated property set !",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x !${pPred} ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - nested inverse of a sequence",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ?x ^(${pPred}/${qPred}) ?y }`,
    quads: pathGraphQuads,
  },
  {
    name: "path - joins with a preceding pattern",
    kind: "select",
    query: `SELECT ?x ?y WHERE { ${path("a")} ${pPred} ?z . ` +
      `?x ${pPred}+ ?y . FILTER(?x = ?z) }`,
    quads: pathGraphQuads,
  },
];

/**
 * aggregateCases covers GROUP BY, HAVING, and the eight aggregates
 * (COUNT/SUM/AVG/MIN/MAX/SAMPLE/GROUP_CONCAT) — each differential against
 * Comunica. Cases with ORDER BY are order-sensitive; GROUP_CONCAT and
 * SAMPLE are only asserted where the group has a deterministic order
 * (single solution or an explicit VALUES sequence).
 */
const aggregateCases: ParityTestCase[] = [
  {
    name: "aggregate - GROUP BY counts with SUM and AVG",
    kind: "select",
    query: `SELECT ?s (COUNT(?o) AS ?c) (SUM(?o) AS ?su) (AVG(?o) AS ?a) ` +
      `WHERE { ?s ${pPred} ?o } GROUP BY ?s ORDER BY ?s`,
    quads: aggregateQuads,
    orderSensitive: true,
  },
  {
    name: "aggregate - no GROUP BY aggregates the whole result",
    kind: "select",
    query: `SELECT (COUNT(*) AS ?c) (MIN(?o) AS ?mn) (MAX(?o) AS ?mx) ` +
      `WHERE { ?s ${pPred} ?o }`,
    quads: aggregateQuads,
  },
  {
    name: "aggregate - COUNT(DISTINCT) and SUM(DISTINCT)",
    kind: "select",
    query: `SELECT (COUNT(DISTINCT ?o) AS ?c) (SUM(DISTINCT ?o) AS ?su) ` +
      `WHERE { ?s ${pPred} ?o }`,
    quads: aggregateQuads,
  },
  {
    name: "aggregate - HAVING filters groups by aggregate",
    kind: "select",
    query: `SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s ${pPred} ?o } ` +
      `GROUP BY ?s HAVING (COUNT(?o) > 2) ORDER BY ?s`,
    quads: aggregateQuads,
    orderSensitive: true,
  },
  {
    name: "aggregate - ORDER BY an aggregate expression",
    kind: "select",
    query: `SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s ${pPred} ?o } ` +
      `GROUP BY ?s ORDER BY DESC(COUNT(?o)) ?s`,
    quads: aggregateQuads,
    orderSensitive: true,
  },
  {
    name: "aggregate - SUM and AVG numeric promotion",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) (AVG(?o) AS ?a) ` +
      `WHERE { VALUES ?o { 1 2 3 } }`,
    quads: [],
  },
  {
    name: "aggregate - SUM and AVG of doubles canonicalize",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) (AVG(?o) AS ?a) ` +
      `WHERE { VALUES ?o { 1.0e0 2.0e0 } }`,
    quads: [],
  },
  {
    name: "aggregate - SUM promotes integer plus decimal",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) WHERE { VALUES ?o { 1 1.5 } }`,
    quads: [],
  },
  {
    name: "aggregate - empty result keeps COUNT/SUM/AVG at zero and GC empty",
    kind: "select",
    query: `SELECT (COUNT(?o) AS ?c) (SUM(?o) AS ?su) (AVG(?o) AS ?a) ` +
      `(GROUP_CONCAT(?o) AS ?gc) WHERE { ?s <http://example.org/none> ?o }`,
    quads: aggregateQuads,
  },
  {
    name: "aggregate - non-numeric SUM and AVG are unbound",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) (AVG(?o) AS ?a) WHERE { ?s ${pPred} ?o }`,
    quads: aggregateQuads,
  },
  {
    name: "aggregate - GROUP_CONCAT separator over a VALUES sequence",
    kind: "select",
    query: `SELECT (GROUP_CONCAT(?o; SEPARATOR = "--") AS ?gc) ` +
      `WHERE { VALUES ?o { 1 2 3 } }`,
    quads: [],
  },
  {
    name: "aggregate - SAMPLE returns the single solution value",
    kind: "select",
    query: `SELECT (SAMPLE(?o) AS ?sp) WHERE { ${path("a")} ${pPred} ?o }`,
    quads: [
      quad(
        namedNode("http://example.org/a"),
        namedNode("http://example.org/p"),
        literal("7"),
      ),
    ],
  },
];

const graphCases: ParityTestCase[] = [
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

const allCases: ParityTestCase[] = [
  ...selectCases,
  ...askCases,
  ...constructCases,
  ...wildcardCases,
  ...pathCases,
  ...aggregateCases,
  ...graphCases,
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

import { assertEquals, assertMatch } from "@std/assert";
import { DataFactory } from "@/term/mod.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
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
  cycleGraphQuads,
  fromDatasetQuads,
  namedGraphQuads,
  pathGraphQuads,
} from "./parity-fixtures.ts";

const { literal, namedNode, quad } = DataFactory;

const foafName = "<http://xmlns.com/foaf/0.1/name>";
const foafKnows = "<http://xmlns.com/foaf/0.1/knows>";
const foafAge = "<http://xmlns.com/foaf/0.1/age>";
const exampleAlice = "<http://example.org/ethan>";
const exampleCarol = "<http://example.org/sandra>";
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

const describeCases: ParityTestCase[] = [
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
    name: "path - one-or-more + includes the start on a cycle",
    kind: "select",
    query: `SELECT ?y WHERE { ${path("a")} ${pPred}+ ?y } ORDER BY ?y`,
    quads: cycleGraphQuads,
    orderSensitive: true,
  },
  {
    name: "path - one-or-more + on a self-loop includes the node",
    kind: "select",
    query: `SELECT ?y WHERE { ${path("c")} ${pPred}+ ?y }`,
    quads: cycleGraphQuads,
  },
  {
    name: "path - zero-or-more * stays reflexive on a cycle",
    kind: "select",
    query: `SELECT ?y WHERE { ${path("a")} ${pPred}* ?y } ORDER BY ?y`,
    quads: cycleGraphQuads,
    orderSensitive: true,
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
  {
    name: "aggregate - SUM of decimals is exact, no float noise (11.1)",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) WHERE { ?s <http://example.org/dec> ?o }`,
    quads: [1.0, 2.2, 3.5, 2.2, 2.2].map((value) =>
      quad(
        namedNode(`http://example.org/d${value}`),
        namedNode("http://example.org/dec"),
        literal(
          String(value),
          namedNode("http://www.w3.org/2001/XMLSchema#decimal"),
        ),
      )
    ),
  },
  {
    name: "aggregate - SUM of decimals strips trailing zeros (1.0 + 2.0)",
    kind: "select",
    query: `SELECT (SUM(?o) AS ?su) WHERE { VALUES ?o { 1.0 2.0 } }`,
    quads: [],
  },
  {
    name: "aggregate - MIN/MAX across mixed numeric datatypes order by value",
    kind: "select",
    query: `SELECT (MIN(?o) AS ?mn) (MAX(?o) AS ?mx) WHERE { ?s ${pPred} ?o }`,
    quads: [
      quad(
        namedNode("http://example.org/m"),
        namedNode("http://example.org/p"),
        literal("1", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      ),
      quad(
        namedNode("http://example.org/m"),
        namedNode("http://example.org/p"),
        literal("2.2", namedNode("http://www.w3.org/2001/XMLSchema#decimal")),
      ),
    ],
  },
  {
    name: "aggregate - MIN/MAX tie on numerically equal literals",
    kind: "select",
    query: `SELECT (MIN(?o) AS ?mn) (MAX(?o) AS ?mx) WHERE { ?s ${pPred} ?o }`,
    quads: [
      quad(
        namedNode("http://example.org/m"),
        namedNode("http://example.org/p"),
        literal("2E-1", namedNode("http://www.w3.org/2001/XMLSchema#double")),
      ),
      quad(
        namedNode("http://example.org/m"),
        namedNode("http://example.org/p"),
        literal("0.2", namedNode("http://www.w3.org/2001/XMLSchema#decimal")),
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

const xsdDateTime = `<http://www.w3.org/2001/XMLSchema#dateTime>`;
const dt = `"2011-01-10T14:45:13.815-05:00"^^${xsdDateTime}`;

const expressionCases: ParityTestCase[] = [
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

const fromCases: ParityTestCase[] = [
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

const allCases: ParityTestCase[] = [
  ...selectCases,
  ...askCases,
  ...constructCases,
  ...describeCases,
  ...wildcardCases,
  ...pathCases,
  ...aggregateCases,
  ...graphCases,
  ...expressionCases,
  ...fromCases,
];

for (const testCase of allCases) {
  Deno.test(`parity - ${testCase.name}`, async () => {
    await assertQueryParity(testCase);
  });
}

Deno.test(
  "parity - known difference: Comunica prefixes blank node labels, Wazoo does not",
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

    const wazooStore = createQuadStore(basicKnowledgeGraphQuads);
    const wazooEngine = new WazooSparqlEngine({ store: wazooStore });
    const wazooResult = await wazooEngine.execute({ query: petQuery });
    assertEquals(wazooResult.kind, "select");
    if (wazooResult.kind !== "select") {
      return;
    }

    // Comunica skolemizes blank nodes from query sources into a per-source
    // prefixed label ("bc_<sourceId>_<label>"); the Wazoo engine deliberately
    // returns the store's own label instead.
    assertMatch(comunicaBindings[0].pet.value, /^bc_\d+_pet-ethan$/);
    assertEquals(wazooResult.data.results.bindings[0].pet.value, "pet-ethan");

    // After stripping the cosmetic prefix, both normalize to the same term.
    assertEquals(
      JSON.stringify(canonicalizeComunicaTerm(comunicaBindings[0].pet)),
      JSON.stringify(
        canonicalizeSparqlValue(wazooResult.data.results.bindings[0].pet),
      ),
    );
  },
);

Deno.test(
  "parity - nondeterministic functions agree on shape (BNODE, UUID, STRUUID, RAND, NOW)",
  async () => {
    const comunicaEngine = getComunicaEngine();
    const comunicaStore = createQuadStore([]);
    const wazooEngine = new WazooSparqlEngine({ store: createQuadStore([]) });
    const shapeQueries = {
      bnode: "SELECT ?v WHERE { BIND(BNODE() AS ?v) }",
      bnodeLabel: 'SELECT ?v WHERE { BIND(BNODE("x") AS ?v) }',
      struuid: "SELECT ?v WHERE { BIND(STRUUID() AS ?v) }",
      uuid: "SELECT ?v WHERE { BIND(UUID() AS ?v) }",
      rand: "SELECT ?v WHERE { BIND(RAND() AS ?v) }",
      now: "SELECT ?v WHERE { BIND(NOW() AS ?v) }",
    };
    for (const [name, query] of Object.entries(shapeQueries)) {
      const comunicaBindings = await runComunicaRawSelectBindings(
        comunicaEngine,
        query,
        comunicaStore,
      );
      const comunicaTerm = comunicaBindings[0].v;
      const wazooResult = await wazooEngine.execute({ query });
      assertEquals(wazooResult.kind, "select");
      if (wazooResult.kind !== "select") {
        continue;
      }
      const wazooTerm = wazooResult.data.results.bindings[0].v;
      const comunicaLiteral = comunicaTerm.termType === "Literal"
        ? comunicaTerm
        : null;
      switch (name) {
        case "bnode":
        case "bnodeLabel":
          assertEquals(comunicaTerm.termType, "BlankNode");
          assertEquals(wazooTerm.type, "bnode");
          break;
        case "struuid": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#string",
          );
          assertEquals(wazooTerm.type, "literal");
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
          };
          assertMatch(
            wazooLiteral.value,
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          );
          break;
        }
        case "uuid":
          assertEquals(comunicaTerm.termType, "NamedNode");
          assertMatch(comunicaTerm.value, /^urn:uuid:/);
          assertEquals(wazooTerm.type, "uri");
          assertMatch(
            (wazooTerm as { type: "uri"; value: string }).value,
            /^urn:uuid:/,
          );
          break;
        case "rand": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#double",
          );
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
            datatype?: string;
          };
          assertEquals(wazooLiteral.type, "literal");
          assertEquals(
            wazooLiteral.datatype,
            "http://www.w3.org/2001/XMLSchema#double",
          );
          const wazooValue = Number(wazooLiteral.value);
          if (!(wazooValue >= 0 && wazooValue < 1)) {
            throw new Error(`RAND out of range: ${wazooValue}`);
          }
          break;
        }
        case "now": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#dateTime",
          );
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
            datatype?: string;
          };
          assertEquals(wazooLiteral.type, "literal");
          assertEquals(
            wazooLiteral.datatype,
            "http://www.w3.org/2001/XMLSchema#dateTime",
          );
          break;
        }
      }
    }
  },
);

Deno.test(
  "parity - known difference: BNODE labels are opaque per engine",
  async () => {
    // Both engines mint a blank node for BNODE("x"), but the labels are
    // engine-specific ("x1" scoped by Comunica, "x" by the wazoo engine).
    // Blank node labels are opaque per SPARQL 1.1, so the parity contract is
    // the term type, not the label.
    const query = `SELECT ?v WHERE { BIND(BNODE("x") AS ?v) }`;
    const comunicaEngine = getComunicaEngine();
    const comunicaBindings = await runComunicaRawSelectBindings(
      comunicaEngine,
      query,
      createQuadStore([]),
    );
    const wazooEngine = new WazooSparqlEngine({
      store: createQuadStore([]),
    });
    const wazooResult = await wazooEngine.execute({ query });
    assertEquals(wazooResult.kind, "select");
    if (wazooResult.kind === "select") {
      assertEquals(comunicaBindings[0].v.termType, "BlankNode");
      assertEquals(wazooResult.data.results.bindings[0].v.type, "bnode");
    }
  },
);

Deno.test("parity - BIND filter scoping", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?p ?o ?z WHERE {
  ?s ?p ?o .
  FILTER(?z = 3)
  BIND(?o + 1 AS ?z)
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("2", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  ];
  await assertQueryParity({
    name: "BIND filter scoping",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - GROUP BY function expression", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?g (COUNT(?p) AS ?cnt) WHERE {
  ?s :p ?p .
} GROUP BY (DATATYPE(?p) AS ?g)`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      literal("123", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/p"),
      literal("hello"),
    ),
  ];
  await assertQueryParity({
    name: "GROUP BY function expression",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - ISNUMERIC built-in function", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?p ?isNum WHERE {
  ?s :p ?p .
  BIND(isNumeric(?p) AS ?isNum)
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      literal("123", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/p"),
      literal("hello"),
    ),
  ];
  await assertQueryParity({
    name: "ISNUMERIC parity",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - ENCODE_FOR_URI function", async () => {
  const query =
    `SELECT ?encoded WHERE { BIND(ENCODE_FOR_URI("hello world! / foo&bar") AS ?encoded) }`;
  await assertQueryParity({
    name: "ENCODE_FOR_URI parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - IRI and URI function", async () => {
  const query =
    `SELECT ?iri ?uri WHERE { BIND(IRI("http://example.org/test") AS ?iri) BIND(URI("http://example.org/test2") AS ?uri) }`;
  await assertQueryParity({
    name: "IRI and URI parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - request-level baseIri resolves relative IRIs (no BASE directive)", async () => {
  const query = `SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`;
  await assertQueryParity({
    name: "request baseIri resolves relative IRIs",
    kind: "select",
    query,
    quads: [],
    baseIri: "http://example.org/root/",
  });
});

Deno.test("parity - BASE directive wins over request-level baseIri", async () => {
  const query = `BASE <http://directive.example/>
SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`;
  await assertQueryParity({
    name: "BASE directive wins over request baseIri",
    kind: "select",
    query,
    quads: [],
    baseIri: "http://request.example/",
  });
});

Deno.test("parity - relative PREFIX IRI resolves against request baseIri", async () => {
  const query = `PREFIX ex: <relative/ns#>
SELECT ?s WHERE { ?s ex:p ?o }`;
  await assertQueryParity({
    name: "relative PREFIX resolves against request baseIri",
    kind: "select",
    query,
    quads: [
      quad(
        namedNode("http://example.org/root/relative/ns#s1"),
        namedNode("http://example.org/root/relative/ns#p"),
        namedNode("http://example.org/o1"),
      ),
    ],
    baseIri: "http://example.org/root/",
  });
});

Deno.test("parity - TZ function", async () => {
  const query = `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?tz1 ?tz2 WHERE {
  BIND(TZ("2011-01-10T14:45:13-05:00"^^xsd:dateTime) AS ?tz1)
  BIND(TZ("2011-01-10T14:45:13Z"^^xsd:dateTime) AS ?tz2)
}`;
  await assertQueryParity({
    name: "TZ parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - non-BMP STRLEN and SUBSTR", async () => {
  const query = `SELECT ?len ?sub WHERE {
  BIND(STRLEN("𐍈bar") AS ?len)
  BIND(SUBSTR("𐍈bar", 1, 2) AS ?sub)
}`;
  await assertQueryParity({
    name: "non-BMP STRLEN and SUBSTR parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - path - negated property set direct and inverse", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?o WHERE {
  ?s !(:p|^:q) ?o
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/o1"),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/q"),
      namedNode("http://example.org/o2"),
    ),
    quad(
      namedNode("http://example.org/sa"),
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://example.org/oa"),
    ),
    quad(
      namedNode("http://example.org/sp"),
      namedNode("http://example.org/p2"),
      namedNode("http://example.org/op"),
    ),
  ];
  await assertQueryParity({
    name: "negated property set direct and inverse parity",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - subquery in WHERE clause", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?o WHERE {
  ?s :p ?mid .
  { SELECT ?mid ?o WHERE { ?mid :q ?o } }
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/m1"),
    ),
    quad(
      namedNode("http://example.org/m1"),
      namedNode("http://example.org/q"),
      namedNode("http://example.org/o1"),
    ),
  ];
  await assertQueryParity({
    name: "subquery in WHERE clause parity",
    kind: "select",
    query,
    quads,
  });
});

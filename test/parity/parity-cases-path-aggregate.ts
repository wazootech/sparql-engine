import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import {
  aggregateQuads,
  cycleGraphQuads,
  pathGraphQuads,
} from "./parity-fixtures.ts";
import { path, pPred, qPred } from "./parity-vocab.ts";

const { literal, namedNode, quad } = DataFactory;

export const pathCases: ParityTestCase[] = [
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
export const aggregateCases: ParityTestCase[] = [
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

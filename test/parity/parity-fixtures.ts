import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { XSD_INTEGER } from "@/term/mod.ts";

const { blankNode, literal, namedNode, quad } = DataFactory;

const exampleResource = (id: string) => namedNode(`http://example.org/${id}`);
const foaf = (id: string) => namedNode(`http://xmlns.com/foaf/0.1/${id}`);
const xsdInteger = namedNode(XSD_INTEGER);

/**
 * basicKnowledgeGraphQuads is the shared RDF fixture used to seed both engines.
 * It covers named nodes, plain literals, language-tagged literals, typed
 * literals, and blank nodes.
 */
export const basicKnowledgeGraphQuads: rdfjs.Quad[] = [
  quad(exampleResource("alice"), foaf("name"), literal("Alice")),
  quad(exampleResource("alice"), foaf("age"), literal("28", xsdInteger)),
  quad(exampleResource("alice"), foaf("knows"), exampleResource("bob")),
  quad(
    exampleResource("alice"),
    exampleResource("pet"),
    blankNode("pet-alice"),
  ),
  quad(exampleResource("bob"), foaf("name"), literal("Bob")),
  quad(exampleResource("bob"), foaf("knows"), exampleResource("carol")),
  quad(exampleResource("carol"), foaf("name"), literal("Carol", "en")),
  quad(exampleResource("carol"), foaf("age"), literal("30", xsdInteger)),
];

/**
 * pathGraphQuads is the shared fixture for property-path parity cases: two
 * routes a→b→c and a→d→c over p, a p-then-q chain c→w, a disconnected q
 * edge z→w, and an isolated p edge x→y.
 */
export const pathGraphQuads: rdfjs.Quad[] = [
  quad(exampleResource("a"), exampleResource("p"), exampleResource("b")),
  quad(exampleResource("b"), exampleResource("p"), exampleResource("c")),
  quad(exampleResource("a"), exampleResource("p"), exampleResource("d")),
  quad(exampleResource("d"), exampleResource("p"), exampleResource("c")),
  quad(exampleResource("c"), exampleResource("q"), exampleResource("w")),
  quad(exampleResource("z"), exampleResource("q"), exampleResource("w")),
  quad(exampleResource("x"), exampleResource("p"), exampleResource("y")),
];

/**
 * aggregateQuads is the shared fixture for GROUP BY/aggregate parity cases:
 * typed integers spread over subjects a/b, plus a non-numeric value on c.
 */
export const aggregateQuads: rdfjs.Quad[] = [
  quad(exampleResource("a"), exampleResource("p"), literal("1", xsdInteger)),
  quad(exampleResource("a"), exampleResource("p"), literal("2", xsdInteger)),
  quad(exampleResource("a"), exampleResource("p"), literal("3", xsdInteger)),
  quad(exampleResource("b"), exampleResource("p"), literal("2", xsdInteger)),
  quad(exampleResource("b"), exampleResource("p"), literal("4", xsdInteger)),
  quad(exampleResource("c"), exampleResource("p"), literal("x")),
];

/**
 * namedGraphQuads is the shared fixture for GRAPH parity cases: one default
 * graph quad plus quads in two named graphs (g1, g2).
 */
export const namedGraphQuads: rdfjs.Quad[] = [
  quad(exampleResource("a"), exampleResource("p"), literal("1")),
  quad(
    exampleResource("a"),
    exampleResource("p"),
    literal("2"),
    namedNode("http://example.org/g1"),
  ),
  quad(
    exampleResource("b"),
    exampleResource("p"),
    literal("3"),
    namedNode("http://example.org/g1"),
  ),
  quad(
    exampleResource("a"),
    exampleResource("p"),
    literal("4"),
    namedNode("http://example.org/g2"),
  ),
];

/**
 * fromDatasetQuads is the shared fixture for FROM / FROM NAMED parity cases:
 * one default-graph quad plus quads in three named graphs (g1, g2, g3).
 */
export const fromDatasetQuads: rdfjs.Quad[] = [
  quad(exampleResource("a"), exampleResource("p"), literal("d")),
  quad(
    exampleResource("a"),
    exampleResource("p"),
    literal("1"),
    namedNode("http://example.org/g1"),
  ),
  quad(
    exampleResource("b"),
    exampleResource("p"),
    literal("2"),
    namedNode("http://example.org/g1"),
  ),
  quad(
    exampleResource("c"),
    exampleResource("p"),
    literal("3"),
    namedNode("http://example.org/g2"),
  ),
  quad(
    exampleResource("d"),
    exampleResource("p"),
    literal("4"),
    namedNode("http://example.org/g3"),
  ),
];

/**
 * createQuadStore builds a fresh N3 Store seeded with the given quads.
 */
export function createQuadStore(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

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
 * createQuadStore builds a fresh N3 Store seeded with the given quads.
 */
export function createQuadStore(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

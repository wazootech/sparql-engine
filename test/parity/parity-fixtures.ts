import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Store } from "n3";

const { blankNode, literal, namedNode, quad } = DataFactory;

const exampleResource = (id: string) => namedNode(`http://example.org/${id}`);
const foaf = (id: string) => namedNode(`http://xmlns.com/foaf/0.1/${id}`);
const xsdInteger = namedNode("http://www.w3.org/2001/XMLSchema#integer");

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
 * createQuadStore builds a fresh N3 Store seeded with the given quads.
 */
export function createQuadStore(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

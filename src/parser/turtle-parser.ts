import type { RdfQuad } from "@/parser/rdf-terms.ts";

import { resetTurtleContext, turtleContext } from "./turtle-context.ts";
import { parseTurtleDocument } from "./turtle-generated.ts";

/**
 * parseTurtleQuads parses Turtle / TriG / N-Triples / N-Quads documents into
 * RDF/JS quads for SPARQL LOAD operations. It is a thin wrapper over the
 * generated parser (`turtle-generated.ts`, from `turtle.jison`), which mirrors
 * the W3C RDF 1.2 TriG grammar — including triple terms (`<<( s p o )>>`),
 * reifiers (`~ r`), and annotation blocks (`{| p o |}`, which emit
 * `reifier rdf:reifies ...` triples per RDF 1.2) — plus N-Quads-style graph
 * labels on top-level statements.
 *
 * Graph labels are preserved: quads from TriG graph blocks or N-Quads
 * statements carry their named graph; unlabeled triples go to the default
 * graph.
 *
 * Blank nodes are standardized apart per document (a fresh counter per
 * parse), so LOADs of different documents never collide.
 *
 * Parse state lives in the typed `turtleContext` (`turtle-context.ts`), which
 * this function resets before each document; the generated parser reads and
 * writes it through the grammar's semantic actions.
 *
 * @param text    the document text
 * @param baseIri base IRI used to resolve relative IRIs (and the IRI reported
 *                for LOAD); relative IRI resolution follows RFC 3986 §5
 * @returns the parsed quads, with graph labels preserved
 */
export function parseTurtleQuads(
  text: string,
  baseIri: string = "",
): RdfQuad[] {
  resetTurtleContext(baseIri);
  parseTurtleDocument(text);
  return turtleContext.quads;
}

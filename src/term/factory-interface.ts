import type {
  RdfBlankNode,
  RdfDefaultGraph,
  RdfDirectionalLanguage,
  RdfLiteral,
  RdfNamedNode,
  RdfQuad,
  RdfTerm,
  RdfVariable,
} from "@/parser/rdf-terms.ts";

/** LocalDataFactory is the term factory over the engine's local term types. */
export interface LocalDataFactory {
  namedNode(value: string): RdfNamedNode;
  blankNode(value?: string): RdfBlankNode;
  literal(
    value: string,
    languageOrDatatype?: string | RdfNamedNode | RdfDirectionalLanguage,
  ): RdfLiteral;
  variable(value: string): RdfVariable;
  defaultGraph(): RdfDefaultGraph;
  quad(
    subject: RdfTerm,
    predicate: RdfTerm,
    object: RdfTerm,
    graph?: RdfTerm,
  ): RdfQuad;
  fromTerm(original: RdfTerm): RdfTerm;
  fromQuad(original: RdfQuad): RdfQuad;
}

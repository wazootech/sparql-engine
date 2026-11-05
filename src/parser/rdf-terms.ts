/**
 * Structural copies of the RDF/JS term interfaces (`@rdfjs/types`) the SPARQL
 * AST is built from.
 *
 * The AST (`ast.ts`) must be analysable by the native compiler (scriptc, issue
 * #221), which cannot represent types imported from an npm package whose
 * implementation is not part of the compiled module graph (SC2013). These
 * interfaces are member-for-member identical to `@rdfjs/types`' `Term`,
 * `NamedNode`, `BlankNode`, `Literal`, `Variable`, `DefaultGraph`, `BaseQuad`
 * and `Quad`, so values flow between the two worlds without conversion or
 * casts: an RDF/JS term is assignable to the AST's `Term` and vice versa.
 */

/** RdfNamedNode is an IRI term. */
export interface RdfNamedNode {
  termType: "NamedNode";
  value: string;
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfBlankNode is a blank node term. */
export interface RdfBlankNode {
  termType: "BlankNode";
  value: string;
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfLiteral is a literal term (plain, language-tagged, or typed). */
export interface RdfLiteral {
  termType: "Literal";
  value: string;
  language: string;
  direction?: "ltr" | "rtl" | "" | null;
  datatype: RdfNamedNode;
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfVariable is a query variable term. */
export interface RdfVariable {
  termType: "Variable";
  value: string;
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfDefaultGraph is the default graph term. */
export interface RdfDefaultGraph {
  termType: "DefaultGraph";
  value: "";
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfBaseQuad is a quad whose components are any terms. */
export interface RdfBaseQuad {
  termType: "Quad";
  value: "";
  subject: RdfTerm;
  predicate: RdfTerm;
  object: RdfTerm;
  graph: RdfTerm;
  equals(other: RdfTerm | null | undefined): boolean;
}

/** RdfQuad is a quad with the RDF/JS component restrictions. */
export interface RdfQuad extends RdfBaseQuad {
  subject: RdfNamedNode | RdfBlankNode | RdfQuad | RdfVariable;
  predicate: RdfNamedNode | RdfVariable;
  object: RdfNamedNode | RdfLiteral | RdfBlankNode | RdfQuad | RdfVariable;
  graph: RdfDefaultGraph | RdfNamedNode | RdfBlankNode | RdfVariable;
}

/** RdfTerm is any RDF/JS term. */
export type RdfTerm =
  | RdfNamedNode
  | RdfBlankNode
  | RdfLiteral
  | RdfVariable
  | RdfDefaultGraph
  | RdfBaseQuad;

/** RdfQuadSubject is a term allowed in a quad's subject position. */
export type RdfQuadSubject = RdfQuad["subject"];

/** RdfQuadPredicate is a term allowed in a quad's predicate position. */
export type RdfQuadPredicate = RdfQuad["predicate"];

/** RdfQuadObject is a term allowed in a quad's object position. */
export type RdfQuadObject = RdfQuad["object"];

/** RdfQuadGraph is a term allowed in a quad's graph position. */
export type RdfQuadGraph = RdfQuad["graph"];

/** RdfDirectionalLanguage is a language tag with an optional direction. */
export interface RdfDirectionalLanguage {
  language: string;
  direction?: "ltr" | "rtl" | "" | null;
}

/** RdfStream is the structural copy of RDF/JS `Stream` (event callback shape). */
export interface RdfStream<T = RdfQuad> {
  on(event: string | symbol, listener: (...args: unknown[]) => void): unknown;
  read(): T | null;
}

/** RdfSource is the structural copy of RDF/JS `Source`: pattern matching. */
export interface RdfSource<T = RdfQuad> {
  match(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): RdfStream<T>;
}

/** RdfStore is the structural copy of RDF/JS `Store`: a source plus mutation. */
export interface RdfStore<T extends RdfQuad = RdfQuad> extends RdfSource<T> {
  addQuad(quad: T): unknown;
  removeQuad(quad: T): unknown;
  import(stream: RdfStream<T>): unknown;
  removeMatches(
    subject?: RdfTerm | null,
    predicate?: RdfTerm | null,
    object?: RdfTerm | null,
    graph?: RdfTerm | null,
  ): unknown;
}

/** RdfDataFactory is the structural copy of RDF/JS `DataFactory`. */
export interface RdfDataFactory {
  namedNode(value: string): RdfNamedNode;
  blankNode(value?: string): RdfBlankNode;
  literal(
    value: string,
    languageOrDatatype?: string | RdfNamedNode,
  ): RdfLiteral;
  variable(value: string): RdfVariable;
  defaultGraph(): RdfDefaultGraph;
  quad(
    subject: RdfTerm,
    predicate: RdfTerm,
    object: RdfTerm,
    graph?: RdfTerm,
  ): RdfQuad;
}

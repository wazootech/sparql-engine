import type * as rdfjs from "@rdfjs/types";
import { DataFactory as localDataFactory } from "@/term/data-factory.ts";

/**
 * InternalDataFactory is the public, RDF/JS-typed view of the engine's
 * DataFactory. The engine builds terms with the local term types (the
 * `Rdf*` interfaces in `parser/rdf-terms.ts`), which are structurally
 * identical to `@rdfjs/types`; this module is the type-only boundary that
 * presents them to consumers as `@rdfjs/types` (including the generic
 * `NamedNode<Iri>` and the `fromTerm` overloads). It is the only place where
 * the factory is cast, and nothing inside the engine imports it.
 */
export interface InternalDataFactory extends rdfjs.DataFactory {
  namedNode<Iri extends string = string>(value: Iri): rdfjs.NamedNode<Iri>;
  blankNode(value?: string): rdfjs.BlankNode;
  literal(
    value: string,
    languageOrDatatype?: string | rdfjs.NamedNode | rdfjs.DirectionalLanguage,
  ): rdfjs.Literal;
  variable(value: string): rdfjs.Variable;
  defaultGraph(): rdfjs.DefaultGraph;
  quad(
    subject: rdfjs.Term,
    predicate: rdfjs.Term,
    object: rdfjs.Term,
    graph?: rdfjs.Term,
  ): rdfjs.Quad;
  fromTerm(original: rdfjs.NamedNode): rdfjs.NamedNode;
  fromTerm(original: rdfjs.BlankNode): rdfjs.BlankNode;
  fromTerm(original: rdfjs.Literal): rdfjs.Literal;
  fromTerm(original: rdfjs.Variable): rdfjs.Variable;
  fromTerm(original: rdfjs.DefaultGraph): rdfjs.DefaultGraph;
  fromTerm(original: rdfjs.BaseQuad): rdfjs.Quad;
  fromQuad(original: rdfjs.Quad): rdfjs.Quad;
}

export const DataFactory: InternalDataFactory =
  localDataFactory as unknown as InternalDataFactory;

export const dataFactory: InternalDataFactory = DataFactory;

import type * as rdfjs from "@rdfjs/types";
import {
  BlankNodeImpl,
  defaultGraphInstance,
  NamedNodeImpl,
  QuadImpl,
  VariableImpl,
} from "@/term/term-impl.ts";
import { LiteralImpl } from "@/term/literal-impl.ts";
export { RDF_LANG_STRING } from "@/term/term-impl.ts";
export { RDF_DIR_LANG_STRING } from "@/term/term-impl.ts";
export { XSD_STRING } from "@/term/term-impl.ts";
export { NamedNodeImpl } from "@/term/term-impl.ts";
export { BlankNodeImpl } from "@/term/term-impl.ts";
export { LiteralImpl } from "@/term/literal-impl.ts";
export { VariableImpl } from "@/term/term-impl.ts";
export { DefaultGraphImpl } from "@/term/term-impl.ts";
export { defaultGraphInstance } from "@/term/term-impl.ts";
export { QuadImpl } from "@/term/term-impl.ts";

let blankNodeCounter = 0;

function fromTermImpl(original: rdfjs.NamedNode): rdfjs.NamedNode;
function fromTermImpl(original: rdfjs.BlankNode): rdfjs.BlankNode;
function fromTermImpl(original: rdfjs.Literal): rdfjs.Literal;
function fromTermImpl(original: rdfjs.Variable): rdfjs.Variable;
function fromTermImpl(original: rdfjs.DefaultGraph): rdfjs.DefaultGraph;
function fromTermImpl(original: rdfjs.BaseQuad): rdfjs.Quad;
function fromTermImpl(original: rdfjs.Term): rdfjs.Term {
  switch (original.termType) {
    case "NamedNode":
      return new NamedNodeImpl(original.value);
    case "BlankNode":
      return new BlankNodeImpl(original.value);
    case "Literal":
      return new LiteralImpl(
        original.value,
        original.language
          ? {
            language: original.language,
            direction: original.direction ?? undefined,
          }
          : original.datatype,
      );
    case "Variable":
      return new VariableImpl(original.value);
    case "DefaultGraph":
      return defaultGraphInstance;
    case "Quad":
      return new QuadImpl(
        original.subject,
        original.predicate,
        original.object,
        original.graph,
      );
  }
}

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

export const DataFactory: InternalDataFactory = {
  namedNode<Iri extends string = string>(value: Iri): rdfjs.NamedNode<Iri> {
    return new NamedNodeImpl(value);
  },
  blankNode(value?: string): rdfjs.BlankNode {
    return new BlankNodeImpl(value ?? `b${++blankNodeCounter}`);
  },
  literal(
    value: string,
    languageOrDatatype?: string | rdfjs.NamedNode | rdfjs.DirectionalLanguage,
  ): rdfjs.Literal {
    return new LiteralImpl(value, languageOrDatatype);
  },
  variable(value: string): rdfjs.Variable {
    return new VariableImpl(value);
  },
  defaultGraph(): rdfjs.DefaultGraph {
    return defaultGraphInstance;
  },
  quad(
    subject: rdfjs.Term,
    predicate: rdfjs.Term,
    object: rdfjs.Term,
    graph?: rdfjs.Term,
  ): rdfjs.Quad {
    return new QuadImpl(subject, predicate, object, graph);
  },
  fromTerm: fromTermImpl,
  fromQuad(original: rdfjs.Quad): rdfjs.Quad {
    return new QuadImpl(
      original.subject,
      original.predicate,
      original.object,
      original.graph,
    );
  },
};

export const dataFactory = DataFactory;

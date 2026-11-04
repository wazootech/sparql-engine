import type * as rdfjs from "@rdfjs/types";

export const RDF_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
export const RDF_DIR_LANG_STRING =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";
export const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export class NamedNodeImpl<Iri extends string = string>
  implements rdfjs.NamedNode<Iri> {
  public readonly termType = "NamedNode" as const;

  public constructor(public readonly value: Iri) {}

  public equals(other?: rdfjs.Term | null): boolean {
    return other != null && other.termType === "NamedNode" &&
      other.value === this.value;
  }
}

export class BlankNodeImpl implements rdfjs.BlankNode {
  public readonly termType = "BlankNode" as const;

  public constructor(public readonly value: string) {}

  public equals(other?: rdfjs.Term | null): boolean {
    return other != null && other.termType === "BlankNode" &&
      other.value === this.value;
  }
}

export class VariableImpl implements rdfjs.Variable {
  public readonly termType = "Variable" as const;

  public constructor(public readonly value: string) {}

  public equals(other?: rdfjs.Term | null): boolean {
    return other != null && other.termType === "Variable" &&
      other.value === this.value;
  }
}

export class DefaultGraphImpl implements rdfjs.DefaultGraph {
  public readonly termType = "DefaultGraph" as const;
  public readonly value = "" as const;

  public equals(other?: rdfjs.Term | null): boolean {
    return other != null && other.termType === "DefaultGraph";
  }
}

export const defaultGraphInstance = new DefaultGraphImpl();

export class QuadImpl implements rdfjs.Quad {
  public readonly termType = "Quad" as const;
  public readonly value = "" as const;
  public readonly subject: rdfjs.Quad_Subject;
  public readonly predicate: rdfjs.Quad_Predicate;
  public readonly object: rdfjs.Quad_Object;
  public readonly graph: rdfjs.Quad_Graph;

  public constructor(
    subject: rdfjs.Term,
    predicate: rdfjs.Term,
    object: rdfjs.Term,
    graph?: rdfjs.Term,
  ) {
    this.subject = subject as rdfjs.Quad_Subject;
    this.predicate = predicate as rdfjs.Quad_Predicate;
    this.object = object as rdfjs.Quad_Object;
    this.graph = (graph ?? defaultGraphInstance) as rdfjs.Quad_Graph;
  }

  public equals(other?: rdfjs.Term | null): boolean {
    if (!other || other.termType !== "Quad") {
      return false;
    }
    return (
      this.subject.equals(other.subject) &&
      this.predicate.equals(other.predicate) &&
      this.object.equals(other.object) &&
      this.graph.equals(other.graph)
    );
  }
}

import type * as rdfjs from "@rdfjs/types";
import type { Pattern, Term as SparqlTerm } from "sparqljs";
import type { SparqlBinding, SparqlValue } from "@/sparql-engine-interface.ts";
import { DataFactory } from "n3";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

/**
 * BgpEvaluator evaluates Basic Graph Patterns (BGPs) against an RDF/JS Store.
 */
export class BgpEvaluator {
  public constructor(
    private readonly store: rdfjs.Store,
  ) {}

  /**
   * evaluateBgp finds all variable bindings matching the given list of triple patterns.
   */
  public async evaluateBgp(patterns: Pattern[]): Promise<SparqlBinding[]> {
    let bindings: SparqlBinding[] = [{}];

    for (const pattern of patterns) {
      if (pattern.type !== "bgp") {
        continue;
      }
      for (const triplePattern of pattern.triples) {
        bindings = await this.joinTriplePattern(bindings, triplePattern);
      }
    }

    return bindings;
  }

  private async joinTriplePattern(
    currentBindings: SparqlBinding[],
    pattern: { subject: SparqlTerm; predicate: SparqlTerm; object: SparqlTerm },
  ): Promise<SparqlBinding[]> {
    const nextBindings: SparqlBinding[] = [];

    for (const binding of currentBindings) {
      const s = this.resolveTerm(pattern.subject, binding);
      const p = this.resolveTerm(pattern.predicate, binding);
      const o = this.resolveTerm(pattern.object, binding);

      const matchingQuads = await this.matchStore(s, p, o);

      for (const matchQuad of matchingQuads) {
        const newBinding = { ...binding };
        let valid = true;

        if (pattern.subject.termType === "Variable") {
          const varName = pattern.subject.value;
          const val = this.rdfTermToSparqlValue(matchQuad.subject);
          if (
            newBinding[varName] && !this.sameValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && pattern.predicate.termType === "Variable") {
          const varName = pattern.predicate.value;
          const val = this.rdfTermToSparqlValue(matchQuad.predicate);
          if (
            newBinding[varName] && !this.sameValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && pattern.object.termType === "Variable") {
          const varName = pattern.object.value;
          const val = this.rdfTermToSparqlValue(matchQuad.object);
          if (
            newBinding[varName] && !this.sameValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid) {
          nextBindings.push(newBinding);
        }
      }
    }

    return nextBindings;
  }

  private resolveTerm(
    term: SparqlTerm,
    binding: SparqlBinding,
  ): rdfjs.Term | null {
    if (term.termType === "Variable") {
      const bound = binding[term.value];
      if (bound) {
        return this.sparqlValueToRdfTerm(bound);
      }
      return null;
    }
    return this.sparqlTermToRdfTerm(term);
  }

  private matchStore(
    s: rdfjs.Term | null,
    p: rdfjs.Term | null,
    o: rdfjs.Term | null,
  ): Promise<rdfjs.Quad[]> {
    return new Promise<rdfjs.Quad[]>((resolve, reject) => {
      const quads: rdfjs.Quad[] = [];
      const stream = this.store.match(s, p, o, null);
      stream.on("data", (q: rdfjs.Quad) => quads.push(q));
      stream.on("end", () => resolve(quads));
      stream.on("error", reject);
    });
  }

  public sparqlTermToRdfTerm(term: SparqlTerm): rdfjs.Term {
    switch (term.termType) {
      case "NamedNode":
        return namedNode(term.value);
      case "BlankNode":
        return blankNode(term.value);
      case "Literal":
        if (term.language) {
          return literal(term.value, term.language);
        }
        if (term.datatype) {
          return literal(term.value, namedNode(term.datatype.value));
        }
        return literal(term.value);
      default:
        throw new Error(`Unsupported term type: ${term.termType}`);
    }
  }

  public sparqlValueToRdfTerm(val: SparqlValue): rdfjs.Term {
    switch (val.type) {
      case "uri":
        return namedNode(val.value);
      case "bnode":
        return blankNode(val.value);
      case "literal":
        if (val["xml:lang"]) {
          return literal(val.value, val["xml:lang"]);
        }
        if (val.datatype) {
          return literal(val.value, namedNode(val.datatype));
        }
        return literal(val.value);
      case "triple":
        return quad(
          this.sparqlValueToRdfTerm(val.value.subject) as rdfjs.Quad_Subject,
          this.sparqlValueToRdfTerm(
            val.value.predicate,
          ) as rdfjs.Quad_Predicate,
          this.sparqlValueToRdfTerm(val.value.object) as rdfjs.Quad_Object,
          defaultGraph(),
        );
    }
  }

  public rdfTermToSparqlValue(term: rdfjs.Term): SparqlValue {
    switch (term.termType) {
      case "NamedNode":
        return { type: "uri", value: term.value };
      case "BlankNode":
        return { type: "bnode", value: term.value };
      case "Literal": {
        const result: SparqlValue = { type: "literal", value: term.value };
        if (term.language) {
          result["xml:lang"] = term.language;
        } else if (
          term.datatype &&
          term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
        ) {
          result.datatype = term.datatype.value;
        }
        return result;
      }
      case "Quad":
        return {
          type: "triple",
          value: {
            subject: this.rdfTermToSparqlValue(term.subject),
            predicate: this.rdfTermToSparqlValue(term.predicate),
            object: this.rdfTermToSparqlValue(term.object),
          },
        };
      default:
        throw new Error(`Unsupported RDF term type: ${term.termType}`);
    }
  }

  private sameValue(a: SparqlValue, b: SparqlValue): boolean {
    if (a.type !== b.type || a.value !== b.value) return false;
    if (a.type === "literal" && b.type === "literal") {
      return a["xml:lang"] === b["xml:lang"] && a.datatype === b.datatype;
    }
    return true;
  }
}

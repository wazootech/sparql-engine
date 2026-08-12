import type * as rdfjs from "@rdfjs/types";
import type { Pattern, Term as SparqlTerm, Triple } from "sparqljs";
import type { SparqlBinding, SparqlValue } from "@/sparql-engine-interface.ts";
import { DataFactory } from "n3";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

/**
 * QuadIndex maps each triple position of the candidate quads to the quads
 * carrying that term, enabling O(1) bucket probes per binding.
 */
type QuadIndex = {
  bySubject: Map<string, rdfjs.Quad[]>;
  byPredicate: Map<string, rdfjs.Quad[]>;
  byObject: Map<string, rdfjs.Quad[]>;
};

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

  /**
   * joinTriplePattern joins the current bindings against a triple pattern with
   * a hash join: candidate quads come from a single indexed store scan using
   * only the pattern's constant positions, and bindings probe a positional
   * index instead of issuing a stream round trip per binding.
   */
  private async joinTriplePattern(
    currentBindings: SparqlBinding[],
    pattern: Triple,
  ): Promise<SparqlBinding[]> {
    const subject = pattern.subject;
    const predicate = this.resolveTriplePredicate(pattern.predicate);
    const object = pattern.object;

    const subjectIsVariable = subject.termType === "Variable";
    const predicateIsVariable = predicate.termType === "Variable";
    const objectIsVariable = object.termType === "Variable";

    const candidateQuads = await this.matchStore(
      this.patternConstant(subject),
      this.patternConstant(predicate),
      this.patternConstant(object),
    );

    const needsIndex = currentBindings.some((binding) =>
      (subjectIsVariable && binding[subject.value] !== undefined) ||
      (predicateIsVariable && binding[predicate.value] !== undefined) ||
      (objectIsVariable && binding[object.value] !== undefined)
    );
    const quadIndex = needsIndex ? this.buildQuadIndex(candidateQuads) : null;

    const nextBindings: SparqlBinding[] = [];

    for (const binding of currentBindings) {
      const resolvedSubject = this.resolveTerm(subject, binding);
      const resolvedPredicate = this.resolveTerm(predicate, binding);
      const resolvedObject = this.resolveTerm(object, binding);

      const matchingQuads = quadIndex === null
        ? candidateQuads
        : this.probeQuads(
          quadIndex,
          candidateQuads,
          resolvedSubject,
          resolvedPredicate,
          resolvedObject,
          subjectIsVariable,
          predicateIsVariable,
          objectIsVariable,
        );

      for (const matchQuad of matchingQuads) {
        if (
          resolvedSubject !== null &&
          !this.sameRdfTerm(matchQuad.subject, resolvedSubject)
        ) {
          continue;
        }
        if (
          resolvedPredicate !== null &&
          !this.sameRdfTerm(matchQuad.predicate, resolvedPredicate)
        ) {
          continue;
        }
        if (
          resolvedObject !== null &&
          !this.sameRdfTerm(matchQuad.object, resolvedObject)
        ) {
          continue;
        }

        const newBinding = { ...binding };
        let valid = true;

        if (subjectIsVariable) {
          const varName = subject.value;
          const val = this.rdfTermToSparqlValue(matchQuad.subject);
          if (
            newBinding[varName] && !this.sameValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && predicateIsVariable) {
          const varName = predicate.value;
          const val = this.rdfTermToSparqlValue(matchQuad.predicate);
          if (
            newBinding[varName] && !this.sameValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && objectIsVariable) {
          const varName = object.value;
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

  /**
   * patternConstant returns the RDF/JS term for a constant pattern position, or
   * null when the position is a variable that must not constrain the scan.
   */
  private patternConstant(term: SparqlTerm): rdfjs.Term | null {
    if (term.termType === "Variable") {
      return null;
    }
    return this.sparqlTermToRdfTerm(term);
  }

  /**
   * buildQuadIndex indexes candidate quads by each of their three positions.
   */
  private buildQuadIndex(quads: rdfjs.Quad[]): QuadIndex {
    const bySubject = new Map<string, rdfjs.Quad[]>();
    const byPredicate = new Map<string, rdfjs.Quad[]>();
    const byObject = new Map<string, rdfjs.Quad[]>();
    for (const item of quads) {
      this.indexQuad(bySubject, this.termKey(item.subject), item);
      this.indexQuad(byPredicate, this.termKey(item.predicate), item);
      this.indexQuad(byObject, this.termKey(item.object), item);
    }
    return { bySubject, byPredicate, byObject };
  }

  /**
   * indexQuad appends a quad to the bucket for the given key.
   */
  private indexQuad(
    index: Map<string, rdfjs.Quad[]>,
    key: string,
    item: rdfjs.Quad,
  ): void {
    const bucket = index.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      index.set(key, [item]);
    }
  }

  /**
   * probeQuads narrows candidate quads to the smallest bucket matching a bound
   * variable position, falling back to all candidates when nothing is bound.
   */
  private probeQuads(
    index: QuadIndex,
    candidateQuads: rdfjs.Quad[],
    resolvedSubject: rdfjs.Term | null,
    resolvedPredicate: rdfjs.Term | null,
    resolvedObject: rdfjs.Term | null,
    subjectIsVariable: boolean,
    predicateIsVariable: boolean,
    objectIsVariable: boolean,
  ): rdfjs.Quad[] {
    const options: Array<[rdfjs.Quad[], rdfjs.Term]> = [];
    if (subjectIsVariable && resolvedSubject !== null) {
      options.push([
        index.bySubject.get(this.termKey(resolvedSubject)) ?? [],
        resolvedSubject,
      ]);
    }
    if (predicateIsVariable && resolvedPredicate !== null) {
      options.push([
        index.byPredicate.get(this.termKey(resolvedPredicate)) ?? [],
        resolvedPredicate,
      ]);
    }
    if (objectIsVariable && resolvedObject !== null) {
      options.push([
        index.byObject.get(this.termKey(resolvedObject)) ?? [],
        resolvedObject,
      ]);
    }
    if (options.length === 0) {
      return candidateQuads;
    }
    options.sort((a, b) => a[0].length - b[0].length);
    return options[0][0];
  }

  /**
   * termKey renders a deterministic key for a term used in the hash index.
   */
  private termKey(term: rdfjs.Term): string {
    switch (term.termType) {
      case "NamedNode":
        return `uri:${term.value}`;
      case "BlankNode":
        return `bnode:${term.value}`;
      case "Variable":
        return `var:${term.value}`;
      case "DefaultGraph":
        return "default";
      case "Literal":
        return (
          `literal:${term.value}|${term.language ?? ""}|` +
          `${term.datatype?.value ?? ""}`
        );
      case "Quad":
        return (
          `quad:${this.termKey(term.subject)}|${
            this.termKey(term.predicate)
          }|` +
          this.termKey(term.object)
        );
      default:
        throw new Error(
          `Unsupported RDF term type: ${(term as rdfjs.Term).termType}`,
        );
    }
  }

  /**
   * sameRdfTerm compares two RDF/JS terms by type, value, and literal
   * language/datatype.
   */
  private sameRdfTerm(a: rdfjs.Term, b: rdfjs.Term): boolean {
    if (a.termType !== b.termType) {
      return false;
    }
    switch (a.termType) {
      case "NamedNode":
        return a.value === (b as rdfjs.NamedNode).value;
      case "BlankNode":
        return a.value === (b as rdfjs.BlankNode).value;
      case "Variable":
        return a.value === (b as rdfjs.Variable).value;
      case "DefaultGraph":
        return true;
      case "Literal":
        return a.value === (b as rdfjs.Literal).value &&
          a.language === (b as rdfjs.Literal).language &&
          (a.datatype?.value ?? "") ===
            ((b as rdfjs.Literal).datatype?.value ?? "");
      case "Quad":
        return this.sameRdfTerm(a.subject, (b as rdfjs.Quad).subject) &&
          this.sameRdfTerm(a.predicate, (b as rdfjs.Quad).predicate) &&
          this.sameRdfTerm(a.object, (b as rdfjs.Quad).object);
      default:
        throw new Error(
          `Unsupported RDF term type: ${(a as rdfjs.Term).termType}`,
        );
    }
  }

  private resolveTriplePredicate(predicate: Triple["predicate"]): SparqlTerm {
    if ("termType" in predicate) {
      return predicate;
    }
    throw new Error(
      `Unsupported property path predicate in BGP triple pattern`,
    );
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

import type * as rdfjs from "@rdfjs/types";
import type { Pattern, Term as SparqlTerm, Triple } from "sparqljs";
import type { SparqlBinding } from "@/sparql-engine-interface.ts";
import {
  rdfTermToSparqlValue,
  sameRdfTerm,
  sameSparqlValue,
  sparqlTermToRdfTerm,
  sparqlValueToRdfTerm,
  termKey,
} from "@/term/mod.ts";

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
          !sameRdfTerm(matchQuad.subject, resolvedSubject)
        ) {
          continue;
        }
        if (
          resolvedPredicate !== null &&
          !sameRdfTerm(matchQuad.predicate, resolvedPredicate)
        ) {
          continue;
        }
        if (
          resolvedObject !== null &&
          !sameRdfTerm(matchQuad.object, resolvedObject)
        ) {
          continue;
        }

        const newBinding = { ...binding };
        let valid = true;

        if (subjectIsVariable) {
          const varName = subject.value;
          const val = rdfTermToSparqlValue(matchQuad.subject);
          if (
            newBinding[varName] && !sameSparqlValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && predicateIsVariable) {
          const varName = predicate.value;
          const val = rdfTermToSparqlValue(matchQuad.predicate);
          if (
            newBinding[varName] && !sameSparqlValue(newBinding[varName], val)
          ) {
            valid = false;
          } else {
            newBinding[varName] = val;
          }
        }

        if (valid && objectIsVariable) {
          const varName = object.value;
          const val = rdfTermToSparqlValue(matchQuad.object);
          if (
            newBinding[varName] && !sameSparqlValue(newBinding[varName], val)
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
    return sparqlTermToRdfTerm(term);
  }

  /**
   * buildQuadIndex indexes candidate quads by each of their three positions.
   */
  private buildQuadIndex(quads: rdfjs.Quad[]): QuadIndex {
    const bySubject = new Map<string, rdfjs.Quad[]>();
    const byPredicate = new Map<string, rdfjs.Quad[]>();
    const byObject = new Map<string, rdfjs.Quad[]>();
    for (const item of quads) {
      this.indexQuad(bySubject, termKey(item.subject), item);
      this.indexQuad(byPredicate, termKey(item.predicate), item);
      this.indexQuad(byObject, termKey(item.object), item);
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
        index.bySubject.get(termKey(resolvedSubject)) ?? [],
        resolvedSubject,
      ]);
    }
    if (predicateIsVariable && resolvedPredicate !== null) {
      options.push([
        index.byPredicate.get(termKey(resolvedPredicate)) ?? [],
        resolvedPredicate,
      ]);
    }
    if (objectIsVariable && resolvedObject !== null) {
      options.push([
        index.byObject.get(termKey(resolvedObject)) ?? [],
        resolvedObject,
      ]);
    }
    if (options.length === 0) {
      return candidateQuads;
    }
    options.sort((a, b) => a[0].length - b[0].length);
    return options[0][0];
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
        return sparqlValueToRdfTerm(bound);
      }
      return null;
    }
    return sparqlTermToRdfTerm(term);
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
}

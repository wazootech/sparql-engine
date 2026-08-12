import type * as rdfjs from "@rdfjs/types";
import type { Pattern, Term as SparqlTerm, Triple } from "sparqljs";
import type { SparqlBinding } from "@/sparql-engine-interface.ts";
import {
  rdfTermToSparqlValue,
  sameRdfTerm,
  sameSparqlValue,
  sparqlTermToRdfTerm,
  sparqlValueKey,
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
 * ScanEntry is a triple pattern with its resolved terms and pre-fetched
 * candidate quads, so join ordering can use true store cardinalities without
 * issuing extra scans.
 */
type ScanEntry = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
  candidates: rdfjs.Quad[];
};

/**
 * BgpEvaluatorOptions configures BgpEvaluator.
 */
export interface BgpEvaluatorOptions {
  /**
   * reorderPatterns dynamically reorders BGP triple patterns by estimated
   * join cost before joining: each pattern is scanned once up front (the
   * hash join scans each pattern exactly once regardless of order), and the
   * pattern minimizing the estimated quad iterations against the current
   * bindings is joined next. The estimate combines the pattern's true store
   * cardinality with bound-variable selectivity, so a pattern whose variable
   * is already bound by earlier joins is processed early even when it has
   * many candidates. Defaults to true. Disabling it preserves written order
   * exactly.
   */
  reorderPatterns?: boolean;
}

/**
 * BgpEvaluator evaluates Basic Graph Patterns (BGPs) against an RDF/JS Store.
 */
export class BgpEvaluator {
  private readonly reorderPatterns: boolean;

  public constructor(
    private readonly store: rdfjs.Store,
    options: BgpEvaluatorOptions = {},
  ) {
    this.reorderPatterns = options.reorderPatterns ?? true;
  }

  /**
   * evaluateBgp finds all variable bindings matching the given list of triple patterns.
   */
  public async evaluateBgp(patterns: Pattern[]): Promise<SparqlBinding[]> {
    // Flatten the triple patterns of all BGP blocks. Joining is a natural
    // join over the patterns, so the join order never changes the resulting
    // binding set — it only changes the intermediate cardinality.
    const triplePatterns: Triple[] = [];
    for (const pattern of patterns) {
      if (pattern.type !== "bgp") {
        continue;
      }
      triplePatterns.push(...pattern.triples);
    }

    if (this.reorderPatterns && triplePatterns.length > 1) {
      return await this.evaluateWithReordering(triplePatterns);
    }

    let bindings: SparqlBinding[] = [{}];
    for (const triplePattern of triplePatterns) {
      bindings = this.joinTriplePattern(
        bindings,
        await this.scanEntry(triplePattern),
      );
    }
    return bindings;
  }

  /**
   * evaluateWithReordering scans every pattern once, then greedily joins the
   * pattern with the lowest estimated cost against the current bindings.
   */
  private async evaluateWithReordering(
    triplePatterns: Triple[],
  ): Promise<SparqlBinding[]> {
    const remaining = await Promise.all(
      triplePatterns.map((pattern) => this.scanEntry(pattern)),
    );

    let bindings: SparqlBinding[] = [{}];
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let index = 0; index < remaining.length; index++) {
        const cost = this.estimateJoinCost(remaining[index], bindings);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      }
      const [chosen] = remaining.splice(bestIndex, 1);
      bindings = this.joinTriplePattern(bindings, chosen);
    }
    return bindings;
  }

  /**
   * scanEntry resolves a triple pattern and pre-fetches the candidate quads
   * matching its constant positions.
   */
  private async scanEntry(pattern: Triple): Promise<ScanEntry> {
    const subject = pattern.subject;
    const predicate = this.resolveTriplePredicate(pattern.predicate);
    const object = pattern.object;
    const candidates = await this.matchStore(
      this.patternConstant(subject),
      this.patternConstant(predicate),
      this.patternConstant(object),
    );
    return { subject, predicate, object, candidates };
  }

  /**
   * estimateJoinCost estimates the number of quad iterations joining the
   * given pattern against the current bindings will perform. Bindings that
   * bind no pattern variable iterate every candidate quad; bindings that bind
   * a pattern variable probe the positional index, costing roughly the
   * average bucket size for the most selective bound variable (candidate
   * count divided by its number of distinct bound values).
   */
  private estimateJoinCost(
    entry: ScanEntry,
    bindings: SparqlBinding[],
  ): number {
    if (bindings.length === 0) {
      return 0;
    }
    let mostSelectiveDistinct = Number.POSITIVE_INFINITY;
    for (const term of [entry.subject, entry.predicate, entry.object]) {
      if (term.termType !== "Variable") {
        continue;
      }
      const distinct = new Set<string>();
      for (const binding of bindings) {
        const value = binding[term.value];
        if (value !== undefined) {
          distinct.add(sparqlValueKey(value));
        }
      }
      if (distinct.size === 0) {
        continue;
      }
      if (distinct.size < mostSelectiveDistinct) {
        mostSelectiveDistinct = distinct.size;
      }
    }
    if (mostSelectiveDistinct === Number.POSITIVE_INFINITY) {
      // No bound pattern variable: every binding iterates all candidates.
      return bindings.length * entry.candidates.length;
    }
    const averageBucket = Math.max(
      1,
      entry.candidates.length /
        mostSelectiveDistinct,
    );
    return bindings.length * averageBucket;
  }

  /**
   * joinTriplePattern joins the current bindings against a triple pattern with
   * a hash join: candidate quads come from the pattern's single indexed store
   * scan (performed once by the caller), and bindings probe a positional
   * index instead of issuing a stream round trip per binding.
   */
  private joinTriplePattern(
    currentBindings: SparqlBinding[],
    entry: ScanEntry,
  ): SparqlBinding[] {
    const subject = entry.subject;
    const predicate = entry.predicate;
    const object = entry.object;

    const subjectIsVariable = subject.termType === "Variable";
    const predicateIsVariable = predicate.termType === "Variable";
    const objectIsVariable = object.termType === "Variable";

    const candidateQuads = entry.candidates;

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
            newBinding[varName] &&
            !sameSparqlValue(newBinding[varName], val)
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
            newBinding[varName] &&
            !sameSparqlValue(newBinding[varName], val)
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
            newBinding[varName] &&
            !sameSparqlValue(newBinding[varName], val)
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

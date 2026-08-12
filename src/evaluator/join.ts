import type * as rdfjs from "@rdfjs/types";
import type { PropertyPath, Term as SparqlTerm, Triple } from "sparqljs";
import {
  buildQuadIndex,
  matchQuads,
  probeQuadIndex,
  simplePredicate,
} from "@/quad-store.ts";
import { sameRdfTerm, sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";

/**
 * TermBinding maps variable names to the RDF/JS terms they resolve to during
 * evaluation. Bindings stay in term space internally; they are converted to
 * the SparqlValue wire format exactly once, at the response boundary.
 */
export type TermBinding = Record<string, rdfjs.Term>;

/**
 * ScanEntry is a triple pattern with its resolved terms and pre-fetched
 * candidate quads, so join ordering can use true store cardinalities without
 * issuing extra scans.
 */
export type ScanEntry = {
  subject: SparqlTerm;
  predicate: SparqlTerm;
  object: SparqlTerm;
  candidates: rdfjs.Quad[];
};

/**
 * BindingFilter decides whether an extended binding survives an OPTIONAL
 * join; it is supplied by the caller (the group evaluator) so the join stays
 * a pure binding-set algebra.
 */
export type BindingFilter = (binding: TermBinding) => boolean;

/**
 * bindingsCompatible reports whether two solution bindings can be merged:
 * every variable bound in both must resolve to the same RDF term (compared
 * structurally, so RDF-star triple terms match by subject/predicate/object).
 */
export function bindingsCompatible(
  a: TermBinding,
  b: TermBinding,
): boolean {
  for (const key of Object.keys(a)) {
    const bValue = b[key];
    if (bValue !== undefined && !sameRdfTerm(a[key], bValue)) {
      return false;
    }
  }
  return true;
}

/**
 * leftJoin implements the OPTIONAL algebra: every left binding is extended
 * with each compatible right binding whose merged binding passes all
 * filters; when nothing matches, the left binding survives unextended. The
 * filters are the OPTIONAL group's own FILTER expressions, evaluated against
 * the merged binding so they can reference outer variables.
 */
export function leftJoin(
  left: TermBinding[],
  right: TermBinding[],
  filters: BindingFilter[] = [],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (filters.every((filter) => filter(merged))) {
        result.push(merged);
        matched = true;
      }
    }
    if (!matched) {
      result.push(l);
    }
  }
  return result;
}

/**
 * innerJoin merges two binding sets with a natural join: every compatible
 * pair of bindings (one from each side) combines into one result, preserving
 * multiset semantics. It threads a group element's independently evaluated
 * solutions (e.g. UNION branches) into the incoming solutions, matching the
 * Join(P, Union(Q1, Q2)) algebra translation.
 */
export function innerJoin(
  left: TermBinding[],
  right: TermBinding[],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    for (const r of right) {
      if (bindingsCompatible(l, r)) {
        result.push({ ...l, ...r });
      }
    }
  }
  return result;
}

/**
 * minus implements the MINUS algebra: a left binding is eliminated exactly
 * when some right binding shares at least one variable with it and is
 * compatible on all of them. Right bindings sharing no variables with a
 * left binding never eliminate it, per SPARQL 1.1 §18.2.2.9.
 */
export function minus(
  left: TermBinding[],
  right: TermBinding[],
): TermBinding[] {
  return left.filter((l) =>
    !right.some((r) => sharesVariable(l, r) && bindingsCompatible(l, r))
  );
}

/**
 * sharesVariable reports whether two bindings both bind at least one
 * variable in common.
 */
function sharesVariable(a: TermBinding, b: TermBinding): boolean {
  for (const key of Object.keys(a)) {
    if (b[key] !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * scanEntry resolves a triple pattern and pre-fetches the candidate quads
 * matching its constant positions.
 */
export function scanEntry(
  store: rdfjs.Store,
  pattern: Triple,
): Promise<ScanEntry> {
  const subject = pattern.subject;
  const predicate = simplePredicate(pattern.predicate);
  const object = pattern.object;
  return matchQuads(
    store,
    patternConstant(subject),
    patternConstant(predicate),
    patternConstant(object),
  ).then((candidates) => ({ subject, predicate, object, candidates }));
}

/**
 * joinTriplePattern joins the current bindings against a triple pattern with
 * a hash join: candidate quads come from the pattern's single indexed store
 * scan (performed once by the caller), and bindings probe a positional index
 * instead of issuing a stream round trip per binding.
 */
export function joinTriplePattern(
  currentBindings: TermBinding[],
  entry: ScanEntry,
): TermBinding[] {
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
  const quadIndex = needsIndex ? buildQuadIndex(candidateQuads) : null;

  const nextBindings: TermBinding[] = [];

  for (const binding of currentBindings) {
    const resolvedSubject = resolveTerm(subject, binding);
    const resolvedPredicate = resolveTerm(predicate, binding);
    const resolvedObject = resolveTerm(object, binding);

    const matchingQuads = quadIndex === null ? candidateQuads : probeQuadIndex(
      quadIndex,
      candidateQuads,
      resolvedSubject,
      resolvedPredicate,
      resolvedObject,
    );

    for (const matchQuad of matchingQuads) {
      const newBinding = { ...binding };
      let valid = true;

      if (subjectIsVariable) {
        const varName = subject.value;
        const val = matchQuad.subject;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
        ) {
          valid = false;
        } else {
          newBinding[varName] = val;
        }
      }

      if (valid && predicateIsVariable) {
        const varName = predicate.value;
        const val = matchQuad.predicate;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
        ) {
          valid = false;
        } else {
          newBinding[varName] = val;
        }
      }

      if (valid && objectIsVariable) {
        const varName = object.value;
        const val = matchQuad.object;
        if (
          newBinding[varName] &&
          !sameRdfTerm(newBinding[varName], val)
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
 * PathPair is one (subject, object) connection produced by a property path.
 */
export type PathPair = { subject: rdfjs.Term; object: rdfjs.Term };

/**
 * PathEntry is a property-path triple pattern with its resolved terms and
 * pre-computed connection pairs.
 */
export type PathEntry = {
  subject: SparqlTerm;
  object: SparqlTerm;
  pairs: PathPair[];
};

/**
 * PathElement is either a plain predicate IRI or a nested property path.
 */
type PathElement = rdfjs.NamedNode | PropertyPath;

/**
 * isPropertyPath reports whether a triple predicate is a property path
 * rather than a simple predicate term.
 */
export function isPropertyPath(
  predicate: unknown,
): predicate is PropertyPath {
  return (
    typeof predicate === "object" &&
    predicate !== null &&
    (predicate as { type?: string }).type === "path"
  );
}

/**
 * scanPathEntry resolves a property-path triple pattern and pre-computes the
 * pairs (subject, object) the path connects. When one endpoint is a constant
 * the path is evaluated from that end (forward from a constant subject,
 * backward from a constant object); when both are variables the full pair
 * set is computed from every graph node. Pair sets are deduplicated, matching
 * SPARQL's path semantics (each pair appears once regardless of how many
 * routes connect it).
 */
export async function scanPathEntry(
  store: rdfjs.Store,
  path: PropertyPath,
  subject: SparqlTerm,
  object: SparqlTerm,
): Promise<PathEntry> {
  const pairs: PathPair[] = [];
  const seen = new Set<string>();
  const addPair = (s: rdfjs.Term, o: rdfjs.Term): void => {
    const key = `${termKey(s)}\u0000${termKey(o)}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ subject: s, object: o });
    }
  };

  const subjectConstant = subject.termType !== "Variable";
  const objectConstant = object.termType !== "Variable";

  if (subjectConstant) {
    const from = sparqlTermToRdfTerm(subject);
    for (const target of await pathSteps(store, path, "forward", from)) {
      addPair(from, target);
    }
  } else if (objectConstant) {
    const to = sparqlTermToRdfTerm(object);
    for (const source of await pathSteps(store, path, "backward", to)) {
      addPair(source, to);
    }
  } else {
    // Both endpoints unbound: evaluate forward from every graph node. The
    // reflexive forms (? and *) include the (node, node) pair themselves.
    for (const node of await graphNodes(store)) {
      for (const target of await pathSteps(store, path, "forward", node)) {
        addPair(node, target);
      }
    }
  }

  return { subject, object, pairs };
}

/**
 * joinPathPattern joins the current bindings against a property-path entry:
 * each binding resolves its subject/object positions and keeps every pair
 * consistent with them, extending the binding with the pair's terms.
 */
export function joinPathPattern(
  currentBindings: TermBinding[],
  entry: PathEntry,
): TermBinding[] {
  const { subject, object, pairs } = entry;
  const subjectIsVariable = subject.termType === "Variable";
  const objectIsVariable = object.termType === "Variable";
  const nextBindings: TermBinding[] = [];

  for (const binding of currentBindings) {
    const resolvedSubject = subjectIsVariable
      ? binding[subject.value] ?? null
      : sparqlTermToRdfTerm(subject);
    const resolvedObject = objectIsVariable
      ? binding[object.value] ?? null
      : sparqlTermToRdfTerm(object);

    for (const pair of pairs) {
      if (
        resolvedSubject !== null &&
        !sameRdfTerm(pair.subject, resolvedSubject)
      ) {
        continue;
      }
      if (
        resolvedObject !== null &&
        !sameRdfTerm(pair.object, resolvedObject)
      ) {
        continue;
      }
      const newBinding = { ...binding };
      let valid = true;
      if (subjectIsVariable) {
        const existing = newBinding[subject.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.subject)) {
          valid = false;
        } else {
          newBinding[subject.value] = pair.subject;
        }
      }
      if (valid && objectIsVariable) {
        const existing = newBinding[object.value];
        if (existing !== undefined && !sameRdfTerm(existing, pair.object)) {
          valid = false;
        } else {
          newBinding[object.value] = pair.object;
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
 * graphNodes returns every term appearing as a subject or object of any quad
 * in the store — the node set the reflexive path forms (? and *) are defined
 * over (per SPARQL 1.1 §9.1, matching Comunica, literals count as nodes).
 */
async function graphNodes(store: rdfjs.Store): Promise<rdfjs.Term[]> {
  const quads = await matchQuads(store, null, null, null);
  const nodes = new Map<string, rdfjs.Term>();
  for (const quad of quads) {
    nodes.set(termKey(quad.subject), quad.subject);
    nodes.set(termKey(quad.object), quad.object);
  }
  return [...nodes.values()];
}

/**
 * pathSteps evaluates one step of a property path from a single anchor term.
 * In forward direction term is the path subject and the result is the set of
 * reachable objects; in backward direction term is the path object and the
 * result is the set of reachable subjects. Results are deduplicated.
 */
async function pathSteps(
  store: rdfjs.Store,
  path: PathElement,
  direction: "forward" | "backward",
  term: rdfjs.Term,
): Promise<rdfjs.Term[]> {
  // A plain IRI is a link path: forward matches outgoing edges, backward
  // matches incoming edges.
  if ("termType" in path) {
    return direction === "forward"
      ? (await matchQuads(store, term, path, null)).map((q) => q.object)
      : (await matchQuads(store, null, path, term)).map((q) => q.subject);
  }

  switch (path.pathType) {
    case "^":
      // The inverse of a path runs the inner path in the opposite direction.
      return pathSteps(
        store,
        path.items[0],
        direction === "forward" ? "backward" : "forward",
        term,
      );
    case "/": {
      const [first, second] = path.items;
      const results: rdfjs.Term[] = [];
      const seen = new Set<string>();
      if (direction === "forward") {
        // term --first--> mid --second--> target
        for (const mid of await pathSteps(store, first, "forward", term)) {
          for (const target of await pathSteps(store, second, "forward", mid)) {
            if (!seen.has(termKey(target))) {
              seen.add(termKey(target));
              results.push(target);
            }
          }
        }
      } else {
        // source --first--> mid --second--> term
        for (const mid of await pathSteps(store, second, "backward", term)) {
          for (const source of await pathSteps(store, first, "backward", mid)) {
            if (!seen.has(termKey(source))) {
              seen.add(termKey(source));
              results.push(source);
            }
          }
        }
      }
      return results;
    }
    case "|": {
      const results: rdfjs.Term[] = [];
      const seen = new Set<string>();
      for (const item of path.items) {
        for (const target of await pathSteps(store, item, direction, term)) {
          if (!seen.has(termKey(target))) {
            seen.add(termKey(target));
            results.push(target);
          }
        }
      }
      return results;
    }
    case "?": {
      // Zero-or-one: the anchor itself plus the inner path's targets.
      const results: rdfjs.Term[] = [term];
      for (
        const target of await pathSteps(
          store,
          path.items[0],
          direction,
          term,
        )
      ) {
        if (!sameRdfTerm(target, term)) {
          results.push(target);
        }
      }
      return results;
    }
    case "*": {
      // Zero-or-more: reflexive-transitive closure of the inner path.
      const results: rdfjs.Term[] = [term];
      const visited = new Set<string>([termKey(term)]);
      const queue: rdfjs.Term[] = [term];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (
          const target of await pathSteps(
            store,
            path.items[0],
            direction,
            current,
          )
        ) {
          const key = termKey(target);
          if (!visited.has(key)) {
            visited.add(key);
            results.push(target);
            queue.push(target);
          }
        }
      }
      return results;
    }
    case "+": {
      // One-or-more: transitive closure of the inner path, no reflexivity.
      const results: rdfjs.Term[] = [];
      const visited = new Set<string>([termKey(term)]);
      const queue: rdfjs.Term[] = [term];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (
          const target of await pathSteps(
            store,
            path.items[0],
            direction,
            current,
          )
        ) {
          const key = termKey(target);
          if (!visited.has(key)) {
            visited.add(key);
            results.push(target);
            queue.push(target);
          }
        }
      }
      return results;
    }
    case "!": {
      // Negated property set: every edge whose predicate is not a listed IRI
      // and whose pair is not an inverse connection of a listed ^IRI.
      const direct = new Set<string>();
      const inverse: rdfjs.NamedNode[] = [];
      for (const item of path.items) {
        if ("termType" in item) {
          direct.add(item.value);
        } else if (item.items[0].termType === "NamedNode") {
          inverse.push(item.items[0]);
        }
      }
      const results: rdfjs.Term[] = [];
      const seen = new Set<string>();
      const quads = direction === "forward"
        ? await matchQuads(store, term, null, null)
        : await matchQuads(store, null, null, term);
      for (const q of quads) {
        if (direct.has(q.predicate.value)) {
          continue;
        }
        const other = direction === "forward" ? q.object : q.subject;
        let excluded = false;
        for (const inv of inverse) {
          if ((await matchQuads(store, other, inv, term)).length > 0) {
            excluded = true;
            break;
          }
        }
        if (excluded) {
          continue;
        }
        const key = termKey(other);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(other);
        }
      }
      return results;
    }
    default:
      throw new Error(
        `Unsupported property path type: ${
          (path as { pathType: string }).pathType
        }`,
      );
  }
}

/**
 * patternConstant returns the RDF/JS term for a constant pattern position, or
 * null when the position is a variable that must not constrain the scan.
 */
function patternConstant(term: SparqlTerm): rdfjs.Term | null {
  if (term.termType === "Variable") {
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

/**
 * resolveTerm resolves a pattern position against a solution binding: bound
 * variables return their term, unbound variables and constants return the
 * term itself (constants via conversion).
 */
function resolveTerm(
  term: SparqlTerm,
  binding: TermBinding,
): rdfjs.Term | null {
  if (term.termType === "Variable") {
    const bound = binding[term.value];
    if (bound) {
      return bound;
    }
    return null;
  }
  return sparqlTermToRdfTerm(term);
}

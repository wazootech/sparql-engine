import type * as rdfjs from "@rdfjs/types";
import { isMultisetPath } from "@/evaluator/path-types.ts";
import type { PathEntry, PathPair } from "@/evaluator/path-types.ts";
import type {
  PropertyPath,
  Term as SparqlTerm,
} from "@/parser/sparql-parser.ts";
import { graphNodesSync } from "@/evaluator/path-sync.ts";
import { pathStepsSync } from "@/evaluator/path-steps-sync.ts";
import { sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";

/**
 * scanPathEntrySync resolves a property-path triple pattern over a
 * pre-materialized quad array (the EXISTS snapshot's graph scope) — the
 * synchronous counterpart to scanPathEntry. Pair semantics are identical:
 * pairs are deduplicated unless the path is multiset, and a constant
 * endpoint prunes the evaluation to that end.
 */
export function scanPathEntrySync(
  candidates: rdfjs.Quad[],
  path: PropertyPath,
  subject: SparqlTerm,
  object: SparqlTerm,
): PathEntry {
  const pairs: PathPair[] = [];
  const seen = new Set<string>();
  const allowDuplicates = isMultisetPath(path);
  const addPair = (s: rdfjs.Term, o: rdfjs.Term): void => {
    if (allowDuplicates) {
      pairs.push({ subject: s, object: o });
    } else {
      const key = `${termKey(s)}\u0000${termKey(o)}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ subject: s, object: o });
      }
    }
  };

  const subjectConstant = subject.termType !== "Variable";
  const objectConstant = object.termType !== "Variable";

  if (subjectConstant) {
    const from = sparqlTermToRdfTerm(subject);
    for (const target of pathStepsSync(candidates, path, "forward", from)) {
      addPair(from, target);
    }
  } else if (objectConstant) {
    const to = sparqlTermToRdfTerm(object);
    for (const source of pathStepsSync(candidates, path, "backward", to)) {
      addPair(source, to);
    }
  } else {
    // Both endpoints unbound: evaluate forward from every graph node. The
    // reflexive forms (? and *) include the (node, node) pair themselves.
    for (const node of graphNodesSync(candidates)) {
      for (const target of pathStepsSync(candidates, path, "forward", node)) {
        addPair(node, target);
      }
    }
  }

  return { subject, object, pairs };
}

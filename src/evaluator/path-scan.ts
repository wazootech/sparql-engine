import type * as rdfjs from "@rdfjs/types";
import { isMultisetPath } from "@/evaluator/path-types.ts";
import type { PathEntry, PathPair } from "@/evaluator/path-types.ts";
import type {
  PropertyPath,
  Term as SparqlTerm,
} from "@/parser/sparql-parser.ts";
import { matchQuads } from "@/quad-store.ts";
import { pathSteps } from "@/evaluator/path-steps.ts";
import { sparqlTermToRdfTerm, termKey } from "@/term/mod.ts";

/**
 * scanPathEntry resolves a property-path triple pattern and pre-computes the
 * pairs (subject, object) the path connects. When one endpoint is a constant
 * the path is evaluated from that end (forward from a constant subject,
 * backward from a constant object); when both are variables the full pair
 * set is computed from every graph node. Pair sets are deduplicated unless the
 * path is multiset, matching SPARQL's path semantics (each pair appears once
 * regardless of how many routes connect it unless the operator is multiset).
 *
 * Prior art: anchoring the walk at a constant endpoint (instead of
 * exploring every node) computes only the reachable set from the bound
 * end — the standard directed-evaluation optimization for reachability
 * queries. {@link https://doi.org/10.1007/978-3-319-25007-6_1 Kostylev et al., "SPARQL with Property Paths," ISWC 2015, LNCS 9366, pp. 3–18} (see also pathSteps)
 */
export async function scanPathEntry(
  store: rdfjs.Source<rdfjs.Quad>,
  path: PropertyPath,
  subject: SparqlTerm,
  object: SparqlTerm,
): Promise<PathEntry> {
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
 * graphNodes returns every term appearing as a subject or object of any quad
 * in the store — the node set the reflexive path forms (? and *) are defined
 * over (per SPARQL 1.1 §9.1, matching Comunica, literals count as nodes).
 */
async function graphNodes(
  store: rdfjs.Source<rdfjs.Quad>,
): Promise<rdfjs.Term[]> {
  const quads = await matchQuads(store, null, null, null);
  const nodes = new Map<string, rdfjs.Term>();
  for (const quad of quads) {
    nodes.set(termKey(quad.subject), quad.subject);
    nodes.set(termKey(quad.object), quad.object);
  }
  return [...nodes.values()];
}

import type { RdfQuad, RdfSource, RdfTerm } from "@/parser/rdf-terms.ts";
import type { PathElement } from "@/evaluator/path-types.ts";
import { collectNpsExclusions, npsEnds } from "@/evaluator/path-nps-items.ts";
import { matchQuads } from "@/quad-store.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

/**
 * pathSteps evaluates one step of a property path from a single anchor term.
 * In forward direction term is the path subject and the result is the set of
 * reachable objects; in backward direction term is the path object and the
 * result is the set of reachable subjects. The closure operators (+, *, ?)
 * return a set of terms. A negated set gives one term per matching edge, and /
 * and | preserve multiplicity too: a sequence is a join on the middle node and
 * an alternation is a union of multisets, so a term appears once per route.
 *
 * Prior art: the semantics are the W3C property-path semantics (SPARQL
 * 1.1 §9.1), formalized by Kostylev et al.; the closures for the * and +
 * operators are breadth-first traversals over the anchored node (CLRS
 * §22.2).
 * @see {@link https://doi.org/10.1007/978-3-319-25007-6_1 Kostylev et al., "SPARQL with Property Paths," ISWC 2015, LNCS 9366, pp. 3–18}
 * @see {@link https://www.w3.org/TR/sparql11-query/ Harris & Seaborne (eds.), "SPARQL 1.1 Query Language," W3C Recommendation, 2013}
 * @see Cormen, Leiserson, Rivest & Stein, "Introduction to Algorithms," 3rd ed., MIT Press, 2009, §22.2 (breadth-first search)
 */
export async function pathSteps(
  store: RdfSource<RdfQuad>,
  path: PathElement,
  direction: "forward" | "backward",
  term: RdfTerm,
): Promise<RdfTerm[]> {
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
      if (direction === "forward") {
        let current = [term];
        for (const item of path.items) {
          const next: RdfTerm[] = [];
          for (const node of current) {
            for (const target of await pathSteps(
              store,
              item,
              "forward",
              node,
            )) {
              next.push(target);
            }
          }
          current = next;
          if (current.length === 0) {
            break;
          }
        }
        return current;
      } else {
        let current = [term];
        for (let i = path.items.length - 1; i >= 0; i--) {
          const item = path.items[i];
          const next: RdfTerm[] = [];
          for (const node of current) {
            for (const source of await pathSteps(
              store,
              item,
              "backward",
              node,
            )) {
              next.push(source);
            }
          }
          current = next;
          if (current.length === 0) {
            break;
          }
        }
        return current;
      }
    }
    case "|": {
      // Alternation is a union of multisets: both branches can yield the
      // same term, and each yield is a separate route, so branch results
      // are concatenated, not deduplicated.
      const results: RdfTerm[] = [];
      for (const item of path.items) {
        for (const target of await pathSteps(store, item, direction, term)) {
          results.push(target);
        }
      }
      return results;
    }
    case "?": {
      // Zero-or-one: the anchor itself plus the inner path's targets.
      const results: RdfTerm[] = [term];
      for (const target of await pathSteps(
        store,
        path.items[0],
        direction,
        term,
      )) {
        if (!sameRdfTerm(target, term)) {
          results.push(target);
        }
      }
      return results;
    }
    case "*": {
      // Zero-or-more: reflexive-transitive closure of the inner path.
      const results: RdfTerm[] = [term];
      const visited = new Set<string>([termKey(term)]);
      const queue: RdfTerm[] = [term];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const target of await pathSteps(
          store,
          path.items[0],
          direction,
          current,
        )) {
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
      // One-or-more: transitive closure of the inner path. The start term is
      // not reflexive for +, but in a cycle it IS reachable from itself via
      // one or more steps, so when the walk returns to it it is emitted once
      // (and never re-queued, keeping the traversal finite).
      const results: RdfTerm[] = [];
      const visited = new Set<string>();
      const queue: RdfTerm[] = [term];
      const startKey = termKey(term);
      let startEmitted = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const target of await pathSteps(
          store,
          path.items[0],
          direction,
          current,
        )) {
          const key = termKey(target);
          if (key === startKey) {
            if (!startEmitted) {
              startEmitted = true;
              results.push(target);
            }
            continue;
          }
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
      // A negated property set is the union of its forward and inverse halves,
      // so one end reached by both appears twice (SPARQL 1.1 §18.2.2.1).
      const exclusions = collectNpsExclusions(path.items);
      const forward = direction === "forward";
      const results: RdfTerm[] = [];
      if (exclusions.direct.size > 0) {
        const quads = await matchQuads(
          store,
          forward ? term : null,
          null,
          forward ? null : term,
        );
        results.push(
          ...npsEnds(quads, exclusions.direct, forward ? "object" : "subject"),
        );
      }
      if (exclusions.hasInverse) {
        const quads = await matchQuads(
          store,
          forward ? null : term,
          null,
          forward ? term : null,
        );
        results.push(
          ...npsEnds(quads, exclusions.inverse, forward ? "subject" : "object"),
        );
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

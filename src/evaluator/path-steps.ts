import type * as rdfjs from "@rdfjs/types";
import type { PathElement } from "@/evaluator/path-types.ts";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";
import { matchQuads } from "@/quad-store.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

/**
 * pathSteps evaluates one step of a property path from a single anchor term.
 * In forward direction term is the path subject and the result is the set of
 * reachable objects; in backward direction term is the path object and the
 * result is the set of reachable subjects. Results are deduplicated.
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
  store: rdfjs.Source<rdfjs.Quad>,
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
      if (direction === "forward") {
        let current = [term];
        for (const item of path.items) {
          const next: rdfjs.Term[] = [];
          for (const node of current) {
            for (
              const target of await pathSteps(store, item, "forward", node)
            ) {
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
          const next: rdfjs.Term[] = [];
          for (const node of current) {
            for (
              const source of await pathSteps(store, item, "backward", node)
            ) {
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
      // One-or-more: transitive closure of the inner path. The start term is
      // not reflexive for +, but in a cycle it IS reachable from itself via
      // one or more steps, so when the walk returns to it it is emitted once
      // (and never re-queued, keeping the traversal finite).
      const results: rdfjs.Term[] = [];
      const visited = new Set<string>();
      const queue: rdfjs.Term[] = [term];
      const startKey = termKey(term);
      let startEmitted = false;
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
      // Negated property set: direct excluded predicates apply to matching edges in the primary direction,
      // and inverse excluded predicates apply to matching edges in the opposite direction.
      const directExcluded = new Set<string>();
      const inverseExcluded = new Set<string>();
      let hasInverse = false;

      const collectNpsItems = (items: PathElement[]) => {
        for (const item of items) {
          if ("termType" in item) {
            directExcluded.add(item.value);
          } else if (
            typeof item === "object" && item !== null && "type" in item
          ) {
            const pObj = item as {
              type: string;
              pathType?: string;
              items?: PathElement[];
            };
            if (pObj.pathType === "|") {
              collectNpsItems(pObj.items ?? []);
            } else if (pObj.pathType === "^") {
              const invItem = pObj.items?.[0] as SparqlTerm | undefined;
              if (invItem?.value) {
                inverseExcluded.add(invItem.value);
                hasInverse = true;
              }
            }
          }
        }
      };
      collectNpsItems(path.items);

      const results: rdfjs.Term[] = [];
      const seen = new Set<string>();

      if (direction === "forward") {
        if (directExcluded.size > 0) {
          const forwardQuads = await matchQuads(store, term, null, null);
          for (const q of forwardQuads) {
            if (!directExcluded.has(q.predicate.value)) {
              const key = termKey(q.object);
              if (!seen.has(key)) {
                seen.add(key);
                results.push(q.object);
              }
            }
          }
        }
        if (hasInverse) {
          const inverseQuads = await matchQuads(store, null, null, term);
          for (const q of inverseQuads) {
            if (!inverseExcluded.has(q.predicate.value)) {
              const key = termKey(q.subject);
              if (!seen.has(key)) {
                seen.add(key);
                results.push(q.subject);
              }
            }
          }
        }
      } else {
        if (directExcluded.size > 0) {
          const backwardQuads = await matchQuads(store, null, null, term);
          for (const q of backwardQuads) {
            if (!directExcluded.has(q.predicate.value)) {
              const key = termKey(q.subject);
              if (!seen.has(key)) {
                seen.add(key);
                results.push(q.subject);
              }
            }
          }
        }
        if (hasInverse) {
          const forwardQuads = await matchQuads(store, term, null, null);
          for (const q of forwardQuads) {
            if (!inverseExcluded.has(q.predicate.value)) {
              const key = termKey(q.object);
              if (!seen.has(key)) {
                seen.add(key);
                results.push(q.object);
              }
            }
          }
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

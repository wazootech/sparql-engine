import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import type { PathElement } from "@/evaluator/path-types.ts";
import { matchQuadsSync } from "@/evaluator/path-sync.ts";
import { sameRdfTerm, termKey } from "@/term/mod.ts";

/**
 * pathStepsSync evaluates one step of a property path from a single anchor
 * term over a pre-materialized quad array — the synchronous counterpart to
 * pathSteps for the EXISTS hooks. In forward direction term is the path
 * subject and the result is the set of reachable objects; in backward
 * direction term is the path object and the result is the set of reachable
 * subjects. The closure operators (+, *, ?) and negated sets return a set
 * of terms, but / and | preserve multiplicity: a sequence is a join on the
 * middle node and an alternation is a union of multisets, so the same term
 * can appear once per distinct route. The semantics mirror the async
 * version exactly (inverse, sequence, alternative, zero-or-one, closures,
 * and negated property sets).
 */
export function pathStepsSync(
  candidates: RdfQuad[],
  path: PathElement,
  direction: "forward" | "backward",
  term: RdfTerm,
): RdfTerm[] {
  // A plain IRI is a link path: forward matches outgoing edges, backward
  // matches incoming edges.
  if ("termType" in path) {
    return direction === "forward"
      ? matchQuadsSync(candidates, term, path, null).map((q) => q.object)
      : matchQuadsSync(candidates, null, path, term).map((q) => q.subject);
  }

  switch (path.pathType) {
    case "^":
      // The inverse of a path runs the inner path in the opposite direction.
      return pathStepsSync(
        candidates,
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
            for (
              const target of pathStepsSync(candidates, item, "forward", node)
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
      }
      let current = [term];
      for (let i = path.items.length - 1; i >= 0; i--) {
        const item = path.items[i];
        const next: RdfTerm[] = [];
        for (const node of current) {
          for (
            const source of pathStepsSync(
              candidates,
              item,
              "backward",
              node,
            )
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
    case "|": {
      // Alternation is a union of multisets: both branches can yield the
      // same term, and each yield is a separate route, so branch results
      // are concatenated, not deduplicated.
      const results: RdfTerm[] = [];
      for (const item of path.items) {
        for (
          const target of pathStepsSync(candidates, item, direction, term)
        ) {
          results.push(target);
        }
      }
      return results;
    }
    case "?": {
      // Zero-or-one: the anchor itself plus the inner path's targets.
      const results: RdfTerm[] = [term];
      for (
        const target of pathStepsSync(
          candidates,
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
      const results: RdfTerm[] = [term];
      const visited = new Set<string>([termKey(term)]);
      const queue: RdfTerm[] = [term];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (
          const target of pathStepsSync(
            candidates,
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
      const results: RdfTerm[] = [];
      const visited = new Set<string>();
      const queue: RdfTerm[] = [term];
      const startKey = termKey(term);
      let startEmitted = false;
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (
          const target of pathStepsSync(
            candidates,
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
      // Negated property set: direct excluded predicates apply to matching
      // edges in the primary direction, and inverse excluded predicates apply
      // to matching edges in the opposite direction.
      const directExcluded = new Set<string>();
      const inverseExcluded = new Set<string>();
      let hasInverse = false;

      const collectNpsItems = (items: PathElement[]) => {
        for (const item of items) {
          // The members are read off one structural view instead of `in`
          // narrowing: scriptc rejects `in` on the parser's union (SC1090,
          // issue #221). A path element has `type: "path"`; a term has
          // `termType`, and both arms read members that exist on their arm.
          const pObj = item as {
            termType?: string;
            value?: string;
            type?: string;
            pathType?: string;
            items?: PathElement[];
          };
          if (pObj.termType !== undefined) {
            directExcluded.add(pObj.value ?? "");
          } else if (pObj.type === "path") {
            if (pObj.pathType === "|") {
              collectNpsItems(pObj.items ?? []);
            } else if (pObj.pathType === "^") {
              const invItem = pObj.items?.[0] as { value?: string } | undefined;
              if (invItem?.value) {
                inverseExcluded.add(invItem.value);
                hasInverse = true;
              }
            }
          }
        }
      };
      collectNpsItems(path.items);

      const results: RdfTerm[] = [];
      const seen = new Set<string>();

      if (direction === "forward") {
        if (directExcluded.size > 0) {
          for (const q of matchQuadsSync(candidates, term, null, null)) {
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
          for (const q of matchQuadsSync(candidates, null, null, term)) {
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
          for (const q of matchQuadsSync(candidates, null, null, term)) {
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
          for (const q of matchQuadsSync(candidates, term, null, null)) {
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

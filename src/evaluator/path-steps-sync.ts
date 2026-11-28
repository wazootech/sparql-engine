import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import type { PathElement } from "@/evaluator/path-types.ts";
import { collectNpsExclusions, npsEnds } from "@/evaluator/path-nps-items.ts";
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
            for (const target of pathStepsSync(
              candidates,
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
      }
      let current = [term];
      for (let i = path.items.length - 1; i >= 0; i--) {
        const item = path.items[i];
        const next: RdfTerm[] = [];
        for (const node of current) {
          for (const source of pathStepsSync(
            candidates,
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
    case "|": {
      // Alternation is a union of multisets: both branches can yield the
      // same term, and each yield is a separate route, so branch results
      // are concatenated, not deduplicated.
      const results: RdfTerm[] = [];
      for (const item of path.items) {
        for (const target of pathStepsSync(candidates, item, direction, term)) {
          results.push(target);
        }
      }
      return results;
    }
    case "?": {
      // Zero-or-one: the anchor itself plus the inner path's targets.
      const results: RdfTerm[] = [term];
      for (const target of pathStepsSync(
        candidates,
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
        for (const target of pathStepsSync(
          candidates,
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
        for (const target of pathStepsSync(
          candidates,
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
        const quads = matchQuadsSync(
          candidates,
          forward ? term : null,
          null,
          forward ? null : term,
        );
        results.push(
          ...npsEnds(quads, exclusions.direct, forward ? "object" : "subject"),
        );
      }
      if (exclusions.hasInverse) {
        const quads = matchQuadsSync(
          candidates,
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

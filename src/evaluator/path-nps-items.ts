import type { RdfNamedNode } from "@/parser/rdf-terms.ts";
import type { PropertyPath } from "@/parser/sparql-parser.ts";

/** PathElement is a predicate IRI or nested property path (negated-set items). */
export type NpsPathElement = RdfNamedNode | PropertyPath;

/** NpsExclusions lists IRIs excluded from a negated property set, by direction. */
export type NpsExclusions = {
  direct: Set<string>;
  inverse: Set<string>;
  hasInverse: boolean;
};

function walkNpsItems(
  pathItems: NpsPathElement[],
  direct: Set<string>,
  inverse: Set<string>,
  state: { hasInverse: boolean },
): void {
  for (const item of pathItems) {
    const asPath = item as PropertyPath;
    if (asPath.type === "path") {
      if (asPath.pathType === "|") {
        walkNpsItems(asPath.items, direct, inverse, state);
      } else if (asPath.pathType === "^") {
        const invItem = asPath.items[0];
        if (invItem !== undefined) {
          const asNamed = invItem as RdfNamedNode;
          if (asNamed.termType === "NamedNode") {
            inverse.add(asNamed.value);
            state.hasInverse = true;
          }
        }
      }
      continue;
    }
    const asNamed = item as RdfNamedNode;
    direct.add(asNamed.value);
  }
}

/**
 * collectNpsExclusions walks negated property-set path items and records
 * excluded predicate IRIs for forward and inverse directions.
 */
export function collectNpsExclusions(items: NpsPathElement[]): NpsExclusions {
  const direct = new Set<string>();
  const inverse = new Set<string>();
  const state = { hasInverse: false };
  walkNpsItems(items, direct, inverse, state);
  return { direct, inverse, hasInverse: state.hasInverse };
}

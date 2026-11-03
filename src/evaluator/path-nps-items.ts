import type { PathElement, PropertyPath } from "@/parser/ast.ts";

/** NpsExclusions lists IRIs excluded from a negated property set, by direction. */
export type NpsExclusions = {
  direct: Set<string>;
  inverse: Set<string>;
  hasInverse: boolean;
};

/**
 * isNestedPath reports whether a negated-set item is a nested path rather than
 * a plain predicate IRI. The `type` discriminant is read through a widened
 * view: scriptc cannot narrow a union with `in`, and asserting an item into the
 * arm it is not aborts the native build.
 */
function isNestedPath(item: PathElement): item is PropertyPath {
  return (item as { type?: string }).type === "path";
}

function walkNpsItems(
  pathItems: PathElement[],
  direct: Set<string>,
  inverse: Set<string>,
  state: { hasInverse: boolean },
): void {
  for (const item of pathItems) {
    // The two arms are read by discriminant, never by assertion: an item that
    // is a plain IRI must not be stored into the path arm (or the reverse).
    if (!isNestedPath(item)) {
      direct.add(item.value);
      continue;
    }
    if (item.pathType === "|") {
      walkNpsItems(item.items, direct, inverse, state);
    } else if (item.pathType === "^") {
      const invItem = item.items[0];
      if (invItem !== undefined && !isNestedPath(invItem)) {
        inverse.add(invItem.value);
        state.hasInverse = true;
      }
    }
  }
}

/**
 * collectNpsExclusions walks negated property-set path items and records
 * excluded predicate IRIs for forward and inverse directions.
 */
export function collectNpsExclusions(items: PathElement[]): NpsExclusions {
  const direct = new Set<string>();
  const inverse = new Set<string>();
  const state = { hasInverse: false };
  walkNpsItems(items, direct, inverse, state);
  return { direct, inverse, hasInverse: state.hasInverse };
}

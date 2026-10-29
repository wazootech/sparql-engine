import {
  bindingsCompatible,
  EMPTY_BINDINGS,
  sharedVars,
} from "@/evaluator/join-bindings.ts";
import type { BindingFilter, TermBinding } from "@/evaluator/join-bindings.ts";
import { passesOptionalFilter } from "@/evaluator/join-bindings.ts";
import {
  buildHashIndex,
  compatibleCandidates,
  JOIN_PRODUCT_THRESHOLD,
  STREAM_NESTED_THRESHOLD,
} from "@/evaluator/join-hash-index.ts";

/**
 * leftJoin implements the OPTIONAL algebra: every left binding is extended
 * with each compatible right binding whose merged binding passes all
 * filters; when nothing matches, the left binding survives unextended. The
 * filters are the OPTIONAL group's own FILTER expressions, evaluated against
 * the merged binding so they can reference outer variables.
 *
 * Large joins dispatch to the hash join (compatibleCandidates); small joins
 * keep the nested loop, which is faster below the hash-setup overhead. Rows
 * are emitted incrementally (issue #74 lazy slice): an array left keeps the
 * exact pre-slice dispatch, while a streaming (generator) left runs a
 * nested loop over small right sides and materializes only when the hash
 * index — which is inherently eager — is required.
 */
export function leftJoin(
  left: Iterable<TermBinding>,
  right: TermBinding[],
  filter?: BindingFilter,
): Iterable<TermBinding> {
  if (right.length === 0) {
    return Array.isArray(left) ? left.slice() : left;
  }
  if (Array.isArray(left)) {
    if (left.length === 0) {
      return EMPTY_BINDINGS;
    }
    if (left.length * right.length <= JOIN_PRODUCT_THRESHOLD) {
      return [...leftJoinNested(left, right, filter)];
    }
    return [...leftJoinHash(left, right, filter)];
  }
  // Native builds (scriptc) only thread array bindings through group evaluation.
  return EMPTY_BINDINGS;
}

function* leftJoinNested(
  left: TermBinding[],
  right: TermBinding[],
  filter?: BindingFilter,
): Generator<TermBinding> {
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (passesOptionalFilter(merged, filter)) {
        yield merged;
        matched = true;
      }
    }
    if (!matched) {
      yield l;
    }
  }
}

function* leftJoinHash(
  left: TermBinding[],
  right: TermBinding[],
  filter?: BindingFilter,
): Generator<TermBinding> {
  const joinVars = sharedVars(left, right);
  if (joinVars.length === 0) {
    for (const binding of leftJoinNested(left, right, filter)) {
      yield binding;
    }
    return;
  }
  const index = buildHashIndex(right, joinVars);
  for (const l of left) {
    let matched = false;
    for (const r of compatibleCandidates(l, joinVars, index, right)) {
      const merged = { ...l, ...r };
      if (passesOptionalFilter(merged, filter)) {
        yield merged;
        matched = true;
      }
    }
    if (!matched) {
      yield l;
    }
  }
}

function* leftJoinStreamNested(
  left: Iterable<TermBinding>,
  right: TermBinding[],
  filters: BindingFilter[] = [],
): Generator<TermBinding> {
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (filters.every((filter) => filter(merged))) {
        yield merged;
        matched = true;
      }
    }
    if (!matched) {
      yield l;
    }
  }
}

function* _leftJoinStreamNested(
  left: Iterable<TermBinding>,
  right: TermBinding[],
  filter?: BindingFilter,
): Generator<TermBinding> {
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (passesOptionalFilter(merged, filter)) {
        yield merged;
        matched = true;
      }
    }
    if (!matched) {
      yield l;
    }
  }
}

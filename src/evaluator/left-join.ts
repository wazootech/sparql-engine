import {
  bindingsCompatible,
  EMPTY_BINDINGS,
  sharedVars,
} from "@/evaluator/join-bindings.ts";
import type { BindingFilter, TermBinding } from "@/evaluator/join-bindings.ts";
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
  left: TermBinding[] | Iterable<TermBinding>,
  right: TermBinding[],
  filters: BindingFilter[] = [],
): Iterable<TermBinding> {
  if (right.length === 0) {
    // No right bindings: every left binding survives unextended. An array
    // left is copied (as before); a streaming left passes through untouched.
    return Array.isArray(left) ? left.slice() : left;
  }
  if (Array.isArray(left)) {
    if (left.length === 0) {
      return EMPTY_BINDINGS;
    }
    if (left.length * right.length <= JOIN_PRODUCT_THRESHOLD) {
      return leftJoinNested(left, right, filters);
    }
    return leftJoinHash(left, right, filters);
  }
  if (right.length <= STREAM_NESTED_THRESHOLD) {
    return leftJoinStreamNested(left, right, filters);
  }
  return leftJoinHash([...left], right, filters);
}

function* leftJoinNested(
  left: TermBinding[],
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

function* leftJoinHash(
  left: TermBinding[],
  right: TermBinding[],
  filters: BindingFilter[] = [],
): Generator<TermBinding> {
  const joinVars = sharedVars(left, right);
  if (joinVars.length === 0) {
    // No variable is bound on both sides: every pair is compatible.
    yield* leftJoinNested(left, right, filters);
    return;
  }
  const index = buildHashIndex(right, joinVars);
  for (const l of left) {
    let matched = false;
    for (const r of compatibleCandidates(l, joinVars, index, right)) {
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

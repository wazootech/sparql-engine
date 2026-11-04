import {
  bindingsCompatible,
  EMPTY_BINDINGS,
  sharedVars,
} from "@/evaluator/join-bindings.ts";
import type { TermBinding } from "@/evaluator/join-bindings.ts";
import {
  buildHashIndex,
  compatibleCandidates,
  JOIN_PRODUCT_THRESHOLD,
  STREAM_NESTED_THRESHOLD,
} from "@/evaluator/join-hash-index.ts";

/**
 * innerJoin merges two binding sets with a natural join: every compatible
 * pair of bindings (one from each side) combines into one result, preserving
 * multiset semantics. It threads a group element's independently evaluated
 * solutions (e.g. UNION branches) into the incoming solutions, matching the
 * Join(P, Union(Q1, Q2)) algebra translation.
 *
 * Large joins dispatch to the hash join; small joins keep the nested loop,
 * which is faster below the hash-setup overhead. Rows are emitted
 * incrementally (issue #74 lazy slice): an array left keeps the exact
 * pre-slice dispatch, while a streaming (generator) left runs a nested loop
 * over small right sides and materializes only when the hash index — which
 * is inherently eager — is required.
 */
export function innerJoin(
  left: TermBinding[] | Iterable<TermBinding>,
  right: TermBinding[],
): Iterable<TermBinding> {
  if (right.length === 0) {
    return EMPTY_BINDINGS;
  }
  if (Array.isArray(left)) {
    if (left.length === 0) {
      return EMPTY_BINDINGS;
    }
    if (left.length * right.length <= JOIN_PRODUCT_THRESHOLD) {
      return innerJoinNested(left, right);
    }
    return innerJoinHash(left, right);
  }
  if (right.length <= STREAM_NESTED_THRESHOLD) {
    return innerJoinStreamNested(left, right);
  }
  return innerJoinHash([...left], right);
}

function* innerJoinNested(
  left: TermBinding[],
  right: TermBinding[],
): Generator<TermBinding> {
  for (const l of left) {
    for (const r of right) {
      if (bindingsCompatible(l, r)) {
        yield { ...l, ...r };
      }
    }
  }
}

function* innerJoinHash(
  left: TermBinding[],
  right: TermBinding[],
): Generator<TermBinding> {
  const joinVars = sharedVars(left, right);
  if (joinVars.length === 0) {
    // No variable is bound on both sides: the result is a cross product.
    yield* innerJoinNested(left, right);
    return;
  }
  const index = buildHashIndex(right, joinVars);
  for (const l of left) {
    for (const r of compatibleCandidates(l, joinVars, index, right)) {
      yield { ...l, ...r };
    }
  }
}

function* innerJoinStreamNested(
  left: Iterable<TermBinding>,
  right: TermBinding[],
): Generator<TermBinding> {
  for (const l of left) {
    for (const r of right) {
      if (bindingsCompatible(l, r)) {
        yield { ...l, ...r };
      }
    }
  }
}

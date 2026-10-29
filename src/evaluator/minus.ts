import {
  bindingsCompatible,
  EMPTY_BINDINGS,
  sharedVars,
  sharesVariable,
} from "@/evaluator/join-bindings.ts";
import type { TermBinding } from "@/evaluator/join-bindings.ts";
import {
  buildHashIndex,
  compatibleCandidates,
  JOIN_PRODUCT_THRESHOLD,
  STREAM_NESTED_THRESHOLD,
} from "@/evaluator/join-hash-index.ts";

/**
 * minus implements the MINUS algebra: a left binding is eliminated exactly
 * when some right binding shares at least one variable with it and is
 * compatible on all of them. Right bindings sharing no variables with a
 * left binding never eliminate it, per SPARQL 1.1 §18.2.2.9.
 *
 * Large joins dispatch to the hash join; small joins keep the nested loop.
 * Rows are emitted incrementally (issue #74 lazy slice): an array left
 * keeps the exact pre-slice dispatch, while a streaming (generator) left
 * runs a nested loop over small right sides and materializes only when the
 * hash index — which is inherently eager — is required.
 */
export function minus(
  left: TermBinding[] | Iterable<TermBinding>,
  right: TermBinding[],
): Iterable<TermBinding> {
  if (right.length === 0) {
    return Array.isArray(left) ? left.slice() : left;
  }
  if (Array.isArray(left)) {
    if (left.length === 0) {
      return EMPTY_BINDINGS;
    }
    if (left.length * right.length <= JOIN_PRODUCT_THRESHOLD) {
      return minusNested(left, right);
    }
    return minusHash(left, right);
  }
  if (right.length <= STREAM_NESTED_THRESHOLD) {
    return minusStreamNested(left, right);
  }
  return minusHash([...left], right);
}

function* minusNested(
  left: TermBinding[],
  right: TermBinding[],
): Generator<TermBinding> {
  for (const l of left) {
    if (!right.some((r) => sharesVariable(l, r) && bindingsCompatible(l, r))) {
      yield l;
    }
  }
}

function* minusHash(
  left: TermBinding[],
  right: TermBinding[],
): Generator<TermBinding> {
  const joinVars = sharedVars(left, right);
  if (joinVars.length === 0) {
    // No variable is bound on both sides: no right binding shares a variable
    // with any left binding, so nothing is eliminated.
    yield* left;
    return;
  }
  const index = buildHashIndex(right, joinVars);
  for (const l of left) {
    let eliminated = false;
    for (const r of compatibleCandidates(l, joinVars, index, right)) {
      if (sharesVariable(l, r)) {
        eliminated = true;
        break;
      }
    }
    if (!eliminated) {
      yield l;
    }
  }
}

function* minusStreamNested(
  left: Iterable<TermBinding>,
  right: TermBinding[],
): Generator<TermBinding> {
  for (const l of left) {
    if (!right.some((r) => sharesVariable(l, r) && bindingsCompatible(l, r))) {
      yield l;
    }
  }
}

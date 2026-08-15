import { assertEquals } from "@std/assert";
import { DataFactory, termKey } from "@/term/mod.ts";
import {
  bindingsCompatible,
  innerJoin,
  leftJoin,
  minus,
  type TermBinding,
} from "@/evaluator/join.ts";

const { namedNode, literal } = DataFactory;

const p = (n: number) => namedNode(`http://example.org/p${n}`);
const lit = (n: number) => literal(`v${n}`);

/** Nested-loop reference implementations (the pre-hash-join semantics). */
function innerJoinRef(
  left: TermBinding[],
  right: TermBinding[],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    for (const r of right) {
      if (bindingsCompatible(l, r)) {
        result.push({ ...l, ...r });
      }
    }
  }
  return result;
}

function leftJoinRef(
  left: TermBinding[],
  right: TermBinding[],
  filters: ((b: TermBinding) => boolean)[] = [],
): TermBinding[] {
  const result: TermBinding[] = [];
  for (const l of left) {
    let matched = false;
    for (const r of right) {
      if (!bindingsCompatible(l, r)) {
        continue;
      }
      const merged = { ...l, ...r };
      if (filters.every((filter) => filter(merged))) {
        result.push(merged);
        matched = true;
      }
    }
    if (!matched) {
      result.push(l);
    }
  }
  return result;
}

function minusRef(left: TermBinding[], right: TermBinding[]): TermBinding[] {
  return left.filter((l) =>
    !right.some((r) =>
      Object.keys(l).some((k) => r[k] !== undefined) &&
      bindingsCompatible(l, r)
    )
  );
}

/** Multiset equality: same bindings (up to key order) with the same counts. */
function assertMultisetEqual(
  actual: TermBinding[],
  expected: TermBinding[],
  label: string,
): void {
  const canon = (b: TermBinding): string =>
    Object.keys(b).sort().map((k) => `${k}=${termKey(b[k])}`).join("|");
  const counts = new Map<string, number>();
  for (const b of expected) {
    const key = canon(b);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const b of actual) {
    const key = canon(b);
    const n = counts.get(key);
    if (n === undefined) {
      throw new Error(`${label}: unexpected binding ${key}`);
    }
    if (n === 1) {
      counts.delete(key);
    } else {
      counts.set(key, n - 1);
    }
  }
  assertEquals(
    counts.size,
    0,
    `${label}: missing ${[...counts.keys()].join(", ")}`,
  );
}

Deno.test("innerJoin - homogeneous join on a shared variable", () => {
  const left = [0, 1, 2].map((n) => ({ s: p(n), a: lit(n) }));
  const right = [0, 1, 2].map((n) => ({ s: p(n), b: lit(n + 10) }));
  const result = [...innerJoin(left, right)];
  assertEquals(result.length, 3);
  assertMultisetEqual(result, innerJoinRef(left, right), "innerJoin");
});

Deno.test("innerJoin - duplicates survive (multiset semantics)", () => {
  const left = [{ s: p(0), a: lit(0) }, { s: p(0), a: lit(0) }];
  const right = [{ s: p(0), b: lit(1) }, { s: p(0), b: lit(1) }];
  const result = [...innerJoin(left, right)];
  assertEquals(result.length, 4);
  assertMultisetEqual(result, innerJoinRef(left, right), "innerJoin");
});

Deno.test("innerJoin - partial left binding is a wildcard on the shared variable", () => {
  // The left binding {b: v0} does not bind ?s, so it is compatible with
  // every right binding (they cannot disagree on ?s).
  const left: TermBinding[] = [{ b: lit(0) }, { s: p(1), b: lit(1) }];
  const right = [{ s: p(0), c: lit(0) }, { s: p(1), c: lit(1) }];
  const result = [...innerJoin(left, right)];
  assertMultisetEqual(result, innerJoinRef(left, right), "innerJoin");
});

Deno.test("leftJoin - unmatched bindings survive unextended", () => {
  const left = [0, 1, 2, 3].map((n) => ({ s: p(n) }));
  const right = [0, 2].map((n) => ({ s: p(n), b: lit(n) }));
  const result = [...leftJoin(left, right)];
  assertEquals(result.length, 4);
  assertMultisetEqual(result, leftJoinRef(left, right), "leftJoin");
});

Deno.test("leftJoin - filters apply to the merged binding", () => {
  const left = [0, 1].map((n) => ({ s: p(n) }));
  const right = [0, 1].map((n) => ({ s: p(n), b: lit(n) }));
  const keepHigh = (b: TermBinding) => b.b !== undefined && b.b.value === "v1";
  const result = [...leftJoin(left, right, [keepHigh])];
  // Only s1 matches the filter; s0 survives unextended.
  assertEquals(result.length, 2);
  assertMultisetEqual(
    result,
    leftJoinRef(left, right, [keepHigh]),
    "leftJoin-filter",
  );
});

Deno.test("leftJoin - heterogeneous left (chained OPTIONAL) probes wildcards", () => {
  // First OPTIONAL succeeded for s0 and s2, failed for s1 and s3.
  const left: TermBinding[] = [
    { s: p(0), a: lit(0), o1: lit(0) },
    { s: p(1), a: lit(1) },
    { s: p(2), a: lit(2), o1: lit(2) },
    { s: p(3), a: lit(3) },
  ];
  const right = [0, 2].map((n) => ({ s: p(n), o2: lit(n + 100) }));
  const result = [...leftJoin(left, right)];
  assertEquals(result.length, 4);
  assertMultisetEqual(result, leftJoinRef(left, right), "leftJoin-chain");
});

Deno.test("minus - eliminates on shared-variable compatibility", () => {
  const left = [0, 1, 2].map((n) => ({ s: p(n) }));
  const right = [0, 2].map((n) => ({ s: p(n), b: lit(n) }));
  const result = [...minus(left, right)];
  assertEquals(result.length, 1);
  assertEquals(result[0].s, p(1));
});

Deno.test("minus - no shared variables means no elimination", () => {
  const left = [0, 1].map((n) => ({ s: p(n) }));
  const right = [{ t: p(0), b: lit(0) }, { t: p(1), b: lit(1) }];
  const result = [...minus(left, right)];
  assertEquals(result.length, 2);
});

Deno.test("minus - partial left binding sharing nothing is not eliminated", () => {
  // The left binding {x: v0} shares no variable with any right binding.
  const left: TermBinding[] = [{ x: lit(0) }, { s: p(1), x: lit(1) }];
  const right = [{ s: p(0), b: lit(0) }, { s: p(1), b: lit(1) }];
  const result = [...minus(left, right)];
  assertMultisetEqual(result, minusRef(left, right), "minus-partial");
});

// Large inputs force the hash-join dispatch (product > JOIN_PRODUCT_THRESHOLD
// = 4096); pin the hash path against the nested-loop reference.
const LARGE = 100;

function largeLeft(): TermBinding[] {
  const out: TermBinding[] = [];
  for (let i = 0; i < LARGE; i++) {
    // Every third binding misses the shared variable ?s — wildcards.
    const b: TermBinding = { a: lit(i % 20) };
    if (i % 3 !== 0) {
      b.s = p(i % 50);
    }
    out.push(b);
  }
  return out;
}

function largeRight(): TermBinding[] {
  const out: TermBinding[] = [];
  for (let i = 0; i < LARGE; i++) {
    out.push({ s: p(i % 50), b: lit(i % 20), c: lit(i) });
  }
  return out;
}

Deno.test("hash join - large innerJoin matches the nested reference", () => {
  const left = largeLeft();
  const right = largeRight();
  const result = [...innerJoin(left, right)];
  assertMultisetEqual(result, innerJoinRef(left, right), "hash-inner");
});

Deno.test("hash join - large leftJoin matches the nested reference", () => {
  const left = largeLeft();
  const right = largeRight();
  const filter = (b: TermBinding) => (b.c === undefined || b.c.value !== "v99");
  const result = [...leftJoin(left, right, [filter])];
  assertMultisetEqual(
    result,
    leftJoinRef(left, right, [filter]),
    "hash-left",
  );
});

Deno.test("hash join - large minus matches the nested reference", () => {
  const left = largeLeft();
  const right = largeRight();
  const result = [...minus(left, right)];
  assertMultisetEqual(result, minusRef(left, right), "hash-minus");
});

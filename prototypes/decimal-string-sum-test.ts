// Correctness (differential vs the BigInt reference) and perf comparison for
// the decimal-string SUM prototype. Run: deno run --allow-all decimal-string-sum-test.ts

import {
  add,
  bigintDecimalSum,
  bigintIntegerSum,
  decimalSum,
  fromLexical,
  stringIntegerSum,
  toString,
} from "./decimal-string-sum.ts";

// --- Unit spot-checks ------------------------------------------------------

const cases: [string, string][] = [
  // Parity-pinned case from aggregate.ts docs.
  ["1.0+2.2+3.5+2.2+2.2", "11.1"],
  // Trailing-zero stripping ("111"/1 -> "11.1", "32"/1 -> "3.2", "3"/1 -> "3").
  ["111+0", "111"],
  ["32+0", "32"],
  // Single values normalize too.
  ["1.50", "1.5"],
  ["-0", "0"],
  // Mixed signs.
  ["1.0+-2.2", "-1.2"],
  ["-1.0+-2.2", "-3.2"],
  ["-2.5+2.5", "0"],
  ["0.1+0.2", "0.3"],
  // Scale alignment.
  ["0.5+0.05+0.005", "0.555"],
  ["100000000000000000000000000000+1", "100000000000000000000000000001"],
  ["-100000000000000000000000000000+1", "-99999999999999999999999999999"],
  ["0.00+0", "0"],
];

let failures = 0;
for (const [expr, expected] of cases) {
  const values = expr.split("+");
  const actual = decimalSum(values);
  if (actual !== expected) {
    console.log(`FAIL ${expr} -> "${actual}" (expected "${expected}")`);
    failures++;
  }
}
console.log(
  failures === 0 ? "unit spot-checks: all pass" : `${failures} failures`,
);

// --- Differential fuzz vs BigInt reference --------------------------------

function randDecimal(rng: () => number): string {
  const intLen = 1 + Math.floor(rng() * 12);
  const scale = Math.floor(rng() * 6);
  let digits = "";
  for (let i = 0; i < intLen + scale; i++) digits += Math.floor(rng() * 10);
  const sign = rng() < 0.5 ? "-" : "";
  const intPart = digits.slice(0, intLen);
  const fracPart = digits.slice(intLen);
  return sign + intPart + (scale > 0 ? "." + fracPart : "");
}

function randInteger(rng: () => number): string {
  let s = "";
  const len = 1 + Math.floor(rng() * 40);
  for (let k = 0; k < len; k++) s += Math.floor(rng() * 10);
  if (rng() < 0.5) s = "-" + s;
  return s.replace(/^0+(?=\d)/, "") || "0";
}

let seed = 0x2f6e2b1;
const rng = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const fuzzN = 20_000;
for (let i = 0; i < fuzzN; i++) {
  const n = 1 + Math.floor(rng() * 40);
  const values: string[] = [];
  for (let j = 0; j < n; j++) values.push(randDecimal(rng));
  const expected = bigintDecimalSum(values);
  const actual = decimalSum(values);
  if (actual !== expected) {
    console.log(`FUZZ FAIL #${i}`, values, "->", actual, "expected", expected);
    failures++;
    if (failures > 5) break;
  }
}
console.log(
  failures === 0
    ? `differential fuzz (${fuzzN} decimal sums): all pass`
    : `${failures} failures total`,
);

for (let i = 0; i < 20_000; i++) {
  const n = 1 + Math.floor(rng() * 40);
  const values: string[] = [];
  for (let j = 0; j < n; j++) values.push(randInteger(rng));
  const expected = bigintIntegerSum(values);
  const actual = stringIntegerSum(values);
  if (actual !== expected) {
    console.log(
      `INT FUZZ FAIL #${i}`,
      values,
      "->",
      actual,
      "expected",
      expected,
    );
    failures++;
    if (failures > 5) break;
  }
}
console.log(
  failures === 0
    ? "integer fuzz (20k sums): all pass"
    : `${failures} failures total`,
);

// --- Perf comparison -------------------------------------------------------

function makeWorkloads(): { decimals: string[][]; integers: string[][] } {
  const decimals: string[][] = [];
  const integers: string[][] = [];
  for (let i = 0; i < 2000; i++) {
    const n = 10 + Math.floor(rng() * 90); // 10..99 terms
    const dv: string[] = [];
    const iv: string[] = [];
    for (let j = 0; j < n; j++) {
      dv.push(randDecimal(rng));
      iv.push(randInteger(rng));
    }
    decimals.push(dv);
    integers.push(iv);
  }
  return { decimals, integers };
}

const { decimals, integers } = makeWorkloads();

function bench(
  name: string,
  fn: (values: string[]) => string,
  ws: string[][],
): void {
  const start = performance.now();
  let sink = 0;
  for (const w of ws) sink += fn(w).length;
  const elapsed = performance.now() - start;
  console.log(
    `${name.padEnd(40)} ${elapsed.toFixed(1).padStart(8)} ms (sink ${sink})`,
  );
}

bench("bigintDecimalSum (ref)", bigintDecimalSum, decimals);
bench("decimalSum (strings) ", decimalSum, decimals);
bench("bigintIntegerSum (ref)", bigintIntegerSum, integers);
bench("stringIntegerSum (strings)", stringIntegerSum, integers);

// Sanity: the reduce form used if the layer replaced the inline loop.
const parts = [
  fromLexical("1.0"),
  fromLexical("2.2"),
  fromLexical("3.5"),
  fromLexical("2.2"),
  fromLexical("2.2"),
];
const sum = parts.reduce(add);
console.log("reduce(add) of 1.0+2.2+3.5+2.2+2.2 =", toString(sum));
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);

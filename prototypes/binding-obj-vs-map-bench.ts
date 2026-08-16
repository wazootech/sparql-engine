// Micro-benchmark: plain-object TermBinding vs Map<string, Term> TermBinding.
// Models the engine's hottest binding operations at typical binding widths.
//
//   - merge: { ...l, ...r } vs Map copy+set (one new binding per join row)
//   - read:  binding[k] vs map.get(k) (per pattern variable per row)
//   - write: binding[k] = t vs map.set(k, t) (per bound pattern variable)
//   - keys:  Object.keys(b) vs [...b.keys()] (sharedVars / serialization)

interface Term {
  termType: string;
  value: string;
}

const mk = (i: number): Term => ({
  termType: "NamedNode",
  value: `https://e/${i}`,
});

function bench(name: string, iterations: number, fn: () => void): void {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const elapsed = performance.now() - start;
  console.log(`${name.padEnd(44)} ${elapsed.toFixed(1).padStart(8)} ms`);
}

// --- Object path ---------------------------------------------------------

function objMerge(
  l: Record<string, Term>,
  r: Record<string, Term>,
): Record<string, Term> {
  return { ...l, ...r };
}

function objMergeLoop(
  l: Record<string, Term>[],
  r: Record<string, Term>[],
): Record<string, Term>[] {
  const out: Record<string, Term>[] = [];
  for (const a of l) {
    for (const b of r) {
      out.push({ ...a, ...b });
    }
  }
  return out;
}

function objRead(b: Record<string, Term>, keys: string[]): Term | undefined {
  for (const k of keys) {
    if (b[k] !== undefined) return b[k];
  }
  return undefined;
}

// --- Map path ------------------------------------------------------------

function mapMerge(
  l: Map<string, Term>,
  r: Map<string, Term>,
): Map<string, Term> {
  const m = new Map(l);
  for (const [k, v] of r) m.set(k, v);
  return m;
}

function mapMergeLoop(
  l: Map<string, Term>[],
  r: Map<string, Term>[],
): Map<string, Term>[] {
  const out: Map<string, Term>[] = [];
  for (const a of l) {
    for (const b of r) {
      const m = new Map(a);
      for (const [k, v] of b) m.set(k, v);
      out.push(m);
    }
  }
  return out;
}

function mapRead(b: Map<string, Term>, keys: string[]): Term | undefined {
  for (const k of keys) {
    const t = b.get(k);
    if (t !== undefined) return t;
  }
  return undefined;
}

// Build realistic inputs: 2-key and 5-key bindings, one overlapping var.
const WIDTH = 3; // keys per side; overlap 1
const N = 400; // bindings per side
const ITER = 40;

const lObj: Record<string, Term>[] = [];
const rObj: Record<string, Term>[] = [];
const lMap: Map<string, Term>[] = [];
const rMap: Map<string, Term>[] = [];
for (let i = 0; i < N; i++) {
  const lo: Record<string, Term> = { s: mk(i) };
  const ro: Record<string, Term> = { s: mk(i) };
  const lm = new Map<string, Term>([["s", mk(i)]]);
  const rm = new Map<string, Term>([["s", mk(i)]]);
  for (let j = 0; j < WIDTH; j++) {
    lo[`a${j}`] = mk(i * 10 + j);
    ro[`b${j}`] = mk(i * 10 + j);
    lm.set(`a${j}`, mk(i * 10 + j));
    rm.set(`b${j}`, mk(i * 10 + j));
  }
  lObj.push(lo);
  rObj.push(ro);
  lMap.push(lm);
  rMap.push(rm);
}

const keys = ["a0", "a1", "a2"];

console.log(`join rows per iter: ${N * N} (${WIDTH} keys/side, 1 shared)`);
console.log("");

bench("obj merge one pair", ITER * 100_000, () => objMerge(lObj[0], rObj[0]));
bench("map merge one pair", ITER * 100_000, () => mapMerge(lMap[0], rMap[0]));

bench("obj full join merge (nested)", ITER, () => objMergeLoop(lObj, rObj));
bench("map full join merge (nested)", ITER, () => mapMergeLoop(lMap, rMap));

bench("obj read 3 vars", ITER * 100_000, () => objRead(lObj[0], keys));
bench("map read 3 vars", ITER * 100_000, () => mapRead(lMap[0], keys));

bench("obj keys", ITER * 100_000, () => Object.keys(lObj[0]));
bench("map keys", ITER * 100_000, () => [...lMap[0].keys()]);

// Write-extension (one pattern variable bound per row).
const objExt = () => {
  const nb = { ...lObj[0] };
  nb.c = mk(1);
  return nb;
};
const mapExt = () => {
  const nb = new Map(lMap[0]);
  nb.set("c", mk(1));
  return nb;
};
bench("obj extend 1 var", ITER * 100_000, objExt);
bench("map extend 1 var", ITER * 100_000, mapExt);

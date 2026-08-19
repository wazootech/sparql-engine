// Verifies the playground dataset fixtures through the engine, per ticket #168:
//
//   deno run --allow-read playground/datasets/verify.ts
//
// For each fixture: read → parseTurtleQuads → MemoryStore → round-trip
// serializeTurtle → re-parse, asserting the quad counts match the generator's
// expectations and the round-trip loses nothing. Prints one line per fixture.

import {
  MemoryStore,
  parseTurtleQuads,
  serializeTurtle,
} from "../../src/mod.ts";

interface Fixture {
  file: string;
  expected: number; // exact quad count (generator math)
  // [s, p, graph?] — at least one quad with this subject + predicate (and
  // graph, when given) must be in the store. The object is left open so the
  // check is term-type-agnostic (literals parse to xsd:string datatypes).
  spotChecks: Array<[string, string, string?]>;
}

const FOAF = "https://xmlns.com/foaf/0.1/";
const EX = "https://example.org/";

const fixtures: Fixture[] = [
  {
    file: "social.ttl",
    // 100 people × 5 base quads + 50 spouse edges (even indexes)
    expected: 100 * 5 + 50,
    spotChecks: [
      [`${EX}person0`, `${FOAF}name`],
      [`${EX}person0`, `${EX}spouse`],
      [`${EX}person1`, `${EX}city`],
    ],
  },
  {
    file: "people10k.trig",
    // 10,000 people × 5 base quads + 5,000 spouse edges + 4 meta quads
    expected: 10_000 * 5 + 5_000 + 4,
    spotChecks: [
      [`${EX}person9999`, `${FOAF}name`],
      [`${EX}person0`, `${EX}spouse`],
      [`${EX}person0`, `${EX}rank`, `${EX}meta`],
    ],
  },
];

function termKey(term: { termType: string; value: string }): string {
  if (term.termType === "Literal") {
    const lit = term as {
      value: string;
      language?: string;
      datatype?: { value: string };
    };
    return `"${lit.value}"${
      lit.language ? `@${lit.language}` : `^^<${lit.datatype?.value ?? ""}>`
    }`;
  }
  if (term.termType === "BlankNode") return `_:${term.value}`;
  return `<${term.value}>`;
}

function quadKey(
  q: { subject: unknown; predicate: unknown; object: unknown; graph: unknown },
): string {
  const k = (t: unknown) => termKey(t as { termType: string; value: string });
  const g =
    (q.graph as { termType: string; value: string }).termType === "DefaultGraph"
      ? ""
      : ` ${k(q.graph)}`;
  return `${k(q.subject)} ${k(q.predicate)} ${k(q.object)}${g}`;
}

let failures = 0;

for (const fixture of fixtures) {
  const t0 = performance.now();
  const text = Deno.readTextFileSync(
    new URL(`./${fixture.file}`, import.meta.url),
  );

  // parse → store
  const quads = parseTurtleQuads(text);
  const store = new MemoryStore(quads);
  const parsedMs = performance.now() - t0;

  // round-trip serialize → re-parse
  const t1 = performance.now();
  const serialized = serializeTurtle(quads);
  const roundTripped = parseTurtleQuads(serialized);
  const rtMs = performance.now() - t1;

  const ok = store.size === fixture.expected &&
    roundTripped.length === fixture.expected;
  if (!ok) failures++;

  let missing = 0;
  for (const [s, p, g] of fixture.spotChecks) {
    const found = [...store.match(
      { termType: "NamedNode", value: s.replace(/^<|>$/g, "") } as never,
      { termType: "NamedNode", value: p.replace(/^<|>$/g, "") } as never,
      null,
      g
        ? { termType: "NamedNode", value: g.replace(/^<|>$/g, "") } as never
        : null,
    )];
    if (found.length === 0) {
      missing++;
      failures++;
    }
  }

  // Round-trip equality: same quad set after serialize → re-parse.
  const rtSet = new Set(roundTripped.map(quadKey));
  let rtMismatch = 0;
  for (const q of quads) {
    if (!rtSet.has(quadKey(q))) rtMismatch++;
  }
  if (rtMismatch > 0) failures++;

  console.log(
    `${fixture.file}: ${store.size.toLocaleString()} quads (expected ${fixture.expected.toLocaleString()}) · ` +
      `parse ${parsedMs.toFixed(0)} ms · round-trip ${rtMs.toFixed(0)} ms · ` +
      `serialized ${(serialized.length / 1024).toFixed(0)} KiB · ` +
      `spot-checks ${
        fixture.spotChecks.length - missing
      }/${fixture.spotChecks.length} · ` +
      `round-trip mismatches ${rtMismatch} → ${
        ok && rtMismatch === 0 ? "PASS" : "FAIL"
      }`,
  );
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  Deno.exit(1);
}
console.log("all fixtures verified");

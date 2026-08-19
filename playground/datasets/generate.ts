// Generates the playground's bundled sample dataset fixtures:
//
//   deno run --allow-write playground/datasets/generate.ts
//
// Deterministic (no randomness): the same bytes are produced on every run, so
// the committed fixtures are reproducible from this script alone. Both
// datasets mirror the shared benchmark graph shape in bench/engine_bench.ts
// (buildPeopleDataset) — name, integer age, blank-node pet, knows ring, city
// tag (5 distinct values), and a spouse edge on even-indexed people only —
// so the EXISTS / join demo queries are the same shapes the README
// benchmarks, at the same data sizes:
//
//   social.ttl      100 people, default graph      ~550 quads   (hand-readable)
//   people10k.trig  10,000 people, default graph   ~55k quads   (the benchmark
//                   + a tiny meta graph                          scale)
//
// The 10k fixture is TriG with a small named graph so GRAPH / FROM demo
// queries have graph material to chew on, but the bulk sits in the default
// graph because the engine's TriG parser is quadratic inside named-graph
// blocks (see generatePeople10k).

const FOAF = "https://xmlns.com/foaf/0.1/";
const EX = "https://example.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const foafName = `${FOAF}name`;
const foafAge = `${FOAF}age`;
const foafKnows = `${FOAF}knows`;
const exPet = `${EX}pet`;
const exCity = `${EX}city`;
const exSpouse = `${EX}spouse`;

const person = (index: number) => `${EX}person${index}`;

// One person block, benchmark shape. Returns the quads (TTL lines, indented
// inside a named-graph block when `indent` is set).
function personLines(index: number, count: number, indent: string): string[] {
  const pad = indent ? indent : "";
  const lines = [
    `${pad}<${person(index)}> <${foafName}> "Person ${index}" ;`,
    `${pad}  <${foafAge}> "${20 + (index % 50)}"^^<${XSD}integer> ;`,
    `${pad}  <${exPet}> _:pet-${index} ;`,
    `${pad}  <${foafKnows}> <${person((index + 1) % count)}> ;`,
    `${pad}  <${exCity}> "City ${index % 5}" .`,
  ];
  if (index % 2 === 0) {
    // Spouse edge on even-indexed people only — OPTIONAL / MINUS / EXISTS
    // null material, exactly like the benchmark graph.
    lines[lines.length - 1] = `${pad}  <${exCity}> "City ${index % 5}" ;`;
    lines.push(`${pad}  <${exSpouse}> <${person(index + 1)}> .`);
  }
  return lines;
}

function preamble(): string[] {
  return [
    `@prefix foaf: <${FOAF}> .`,
    `@prefix ex: <${EX}> .`,
    `@prefix xsd: <${XSD}> .`,
    "",
  ];
}

function generateSocial(count: number): string {
  const out: string[] = [...preamble()];
  for (let index = 0; index < count; index++) {
    out.push(...personLines(index, count, ""));
    out.push("");
  }
  return `${out.join("\n")}`;
}

// Layout note (measured): the engine's TriG parser is quadratic inside
// named-graph blocks (5.5k quads in a block ≈ 0.8 s, 22k ≈ 13 s — n²), while
// default-graph Turtle parses linearly (55k quads ≈ 0.9 s). So the 10k
// fixture puts the bulk in the default graph and keeps only a tiny named
// graph for GRAPH demo material — the page loads in under a second and GRAPH
// queries still have a graph to chew on.
function generatePeople10k(
  count: number,
  metaQuads: Array<[string, string, string]>,
): string {
  const out: string[] = [...preamble()];
  for (let index = 0; index < count; index++) {
    out.push(...personLines(index, count, ""));
    out.push("");
  }
  if (metaQuads.length > 0) {
    out.push(`<${EX}meta> {`);
    for (const [s, p, o] of metaQuads) {
      out.push(`  <${s}> <${p}> "${o}" .`);
    }
    out.push("}");
  }
  return `${out.join("\n")}\n`;
}

const SOCIAL_COUNT = 100;
const PEOPLE10K_COUNT = 10_000;

const metaQuads: Array<[string, string, string]> = [
  [`${EX}person0`, `${EX}rank`, "1"],
  [`${EX}person1`, `${EX}rank`, "2"],
  [`${EX}person2`, `${EX}rank`, "3"],
  [`${EX}person3`, `${EX}rank`, "4"],
];

const social = generateSocial(SOCIAL_COUNT);
const people10k = generatePeople10k(PEOPLE10K_COUNT, metaQuads);

Deno.writeTextFileSync(
  new URL("./social.ttl", import.meta.url),
  social,
);
Deno.writeTextFileSync(
  new URL("./people10k.trig", import.meta.url),
  people10k,
);

// Quad counts, reported the way the ticket wants them (counted on the parse
// side by verify.ts; here we report the structural expectation).
const socialQuads = SOCIAL_COUNT * 5 + (SOCIAL_COUNT / 2);
const peopleQuads = PEOPLE10K_COUNT * 5 + (PEOPLE10K_COUNT / 2) +
  metaQuads.length;
console.log(
  `wrote social.ttl (${social.length.toLocaleString()} bytes, ~${socialQuads} quads) and ` +
    `people10k.trig (${people10k.length.toLocaleString()} bytes, ~${peopleQuads.toLocaleString()} quads)`,
);

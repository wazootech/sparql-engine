/**
 * Held-out differential fuzz: wazoo vs Comunica vs Oxigraph.
 *
 * Purpose: answer the blind-test question on the W3C conformance claim.
 * The W3C suite, the parity suite, the EXISTS cross-check and the bench
 * queries are all in the repo and were all visible to the agents that built
 * the engine. This script generates its queries and data at runtime from a
 * seed, so no generated case existed in the repo before the run. The engine
 * is NOT modified to pass this script: mismatches are reported, not fixed.
 *
 * Method:
 * - A seeded PRNG (mulberry32, seed 20261110) builds one random RDF graph
 *   (60 people: name, age, score, city, knows edges, tags, nickname) and
 *   260 random SPARQL queries across 13 families.
 * - Every query runs through all three engines over identical data.
 * - SELECT is compared as a sorted multiset of canonical binding records.
 *   ORDER BY queries use DISTINCT plus ORDER BY over every projected
 *   variable, so their order is total: wazoo's order is compared ordered
 *   against Oxigraph, while Comunica is compared as a multiset only (see
 *   the Comunica ORDER BY note below).
 * - ASK compares booleans; CONSTRUCT compares canonical quad sets, with the
 *   reference sides deduplicated per the issue #87 graph-content contract
 *   and the wazoo side as-emitted.
 * - The exit code is the CI gate: it fails only when wazoo is the lone
 *   outlier (both reference engines agree with each other and disagree
 *   with wazoo), when all three disagree, or on an engine error. A
 *   mismatch where wazoo agrees with one reference engine is a
 *   reference-engine divergence, reported but not a wazoo regression.
 *
 * Deliberately excluded, because the engines are *known* to disagree there
 * and the disagreement would be a false positive, not an engine bug:
 * - Comunica ORDER BY: Comunica emits rows out of ascending order on
 *   multi-key ORDER BY queries (observed: ORDER BY ?name ?age ?person
 *   returning age 66 before age 54 within one name), while wazoo and
 *   Oxigraph both emit the ascending order. The fuzz therefore checks
 *   Comunica's ORDER BY rows as a multiset and checks wazoo's order
 *   against Oxigraph only.
 * - Oxigraph alternation: Oxigraph deduplicates the branches of an
 *   alternation path (observed: (knows|knows) returns each pair once),
 *   while wazoo and Comunica preserve the union multiplicity (each pair
 *   twice). The gate fails only when wazoo is the lone outlier, so this
 *   reference-engine split is reported, not a wazoo regression.
 * - FILTER EXISTS / subquery EXISTS (Comunica correlates subqueries with
 *   outer bindings, wrong per SPARQL 1.1 section 18.2.4; see
 *   test/w3c/exists-ref.ts).
 * - AVG / decimal arithmetic (engines emit different lexical forms for
 *   decimals, e.g. "2.0E1" vs "20").
 * - DESCRIBE, REDUCED, SERVICE, FROM / FROM NAMED, named graphs, LIMIT 0.
 * - Blank nodes in the data or in CONSTRUCT templates (labels are
 *   engine-local; the parity suite already covers blank-node isomorphism).
 *
 * Run with:  deno run --allow-all --allow-write bench/heldout-fuzz.ts
 *   Optional: --seed <n> --count <n-per-family>
 * Writes bench/heldout-fuzz-report.json next to this file.
 */

import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import {
  blankNode as oxigraphBlankNode,
  defaultGraph as oxigraphDefaultGraph,
  literal as oxigraphLiteral,
  namedNode as oxigraphNamedNode,
  quad as oxigraphQuad,
  Store as OxigraphStore,
} from "oxigraph";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "../test/parity/parity-harness.ts";
import {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  XSD_INTEGER,
} from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";

const { literal, namedNode, quad } = DataFactory;
const EX = "http://example.org/";
const xsdInteger = namedNode(XSD_INTEGER);
const ex = (name: string) => namedNode(EX + name);
const exIri = (name: string) => `<${EX}${name}>`;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — the whole run is reproducible from the seed.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const args = Deno.args;
const seedArg = args.indexOf("--seed");
const countArg = args.indexOf("--count");
const SEED = seedArg === -1 ? 20261110 : Number(args[seedArg + 1]);
const PER_FAMILY = countArg === -1 ? 20 : Number(args[countArg + 1]);
const random = mulberry32(SEED);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function pickN<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  const out: T[] = [];
  while (copy.length > 0 && out.length < count) {
    out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  }
  return out;
}

function intBetween(low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

// ---------------------------------------------------------------------------
// Random dataset: 60 people, generated from the seed, never in the repo.
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Ada",
  "Ben",
  "Cleo",
  "Dan",
  "Eve",
  "Finn",
  "Gia",
  "Hugo",
  "Ivy",
  "Jude",
  "Kira",
  "Leo",
  "Mia",
  "Nate",
  "Ora",
  "Pete",
  "Quinn",
  "Rosa",
  "Sam",
  "Tara",
  "Uma",
  "Vic",
  "Wren",
  "Yara",
] as const;
const CITIES = ["Oslo", "Lima", "Kyoto", "Cairo", "Perth", "Quito"] as const;
const TAGS = [
  "sailing",
  "chess",
  "baking",
  "hiking",
  "poetry",
  "coding",
  "gardening",
  "jazz",
] as const;
const PERSON_COUNT = 60;

function buildDataset(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < PERSON_COUNT; index++) {
    const person = ex(`person${index}`);
    quads.push(quad(person, ex("name"), literal(pick(FIRST_NAMES))));
    quads.push(
      quad(person, ex("age"), literal(`${intBetween(18, 80)}`, xsdInteger)),
    );
    quads.push(
      quad(person, ex("score"), literal(`${intBetween(0, 100)}`, xsdInteger)),
    );
    quads.push(quad(person, ex("city"), literal(pick(CITIES))));
    quads.push(
      quad(person, ex("nick"), literal(pick(FIRST_NAMES).toLowerCase(), "en")),
    );
    const knowsCount = intBetween(0, 3);
    for (
      const target of pickN(
        Array.from({ length: PERSON_COUNT }, (_, i) => i).filter((i) =>
          i !== index
        ),
        knowsCount,
      )
    ) {
      quads.push(quad(person, ex("knows"), ex(`person${target}`)));
    }
    for (const tag of pickN(TAGS, intBetween(0, 2))) {
      quads.push(quad(person, ex("tag"), literal(tag)));
    }
  }
  return quads;
}

const dataset = buildDataset();

// ---------------------------------------------------------------------------
// Engine setup: identical data in all three stores.
// ---------------------------------------------------------------------------

function seedStore(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) store.addQuad(item);
  return store;
}

function toOxigraphTerm(term: rdfjs.Term): unknown {
  switch (term.termType) {
    case "NamedNode":
      return oxigraphNamedNode(term.value);
    case "BlankNode":
      return oxigraphBlankNode(term.value);
    case "Literal":
      if (term.language) return oxigraphLiteral(term.value, term.language);
      if (term.datatype) {
        return oxigraphLiteral(
          term.value,
          oxigraphNamedNode(term.datatype.value),
        );
      }
      return oxigraphLiteral(term.value);
    case "DefaultGraph":
      return oxigraphDefaultGraph();
    default:
      throw new Error(`Unsupported term type: ${term.termType}`);
  }
}

function seedOxigraphStore(quads: rdfjs.Quad[]): OxigraphStore {
  const store = new OxigraphStore();
  for (const item of quads) {
    store.add(
      oxigraphQuad(
        toOxigraphTerm(item.subject) as Parameters<typeof oxigraphQuad>[0],
        toOxigraphTerm(item.predicate) as Parameters<typeof oxigraphQuad>[1],
        toOxigraphTerm(item.object) as Parameters<typeof oxigraphQuad>[2],
        toOxigraphTerm(item.graph) as Parameters<typeof oxigraphQuad>[3],
      ),
    );
  }
  return store;
}

const wazooStore = seedStore(dataset);
const comunicaStore = seedStore(dataset);
const oxigraphStore = seedOxigraphStore(dataset);
const wazooEngine = new WazooSparqlEngine({ store: wazooStore });
const comunicaEngine = getComunicaEngine();

// ---------------------------------------------------------------------------
// Canonical result rendering (same normalization as the parity harness).
// ---------------------------------------------------------------------------

function bindingRecord(record: Record<string, CanonicalTerm>): string {
  return JSON.stringify(
    Object.keys(record).sort().map((name) => [name, record[name]]),
  );
}

function quadRecord(
  item: rdfjs.Quad,
  canonicalize: (term: rdfjs.Term) => CanonicalTerm,
): string {
  return [item.subject, item.predicate, item.object, item.graph]
    .map((term) => JSON.stringify(canonicalize(term)))
    .join(" ");
}

type OxigraphBinding = {
  get(name: string): unknown;
  keys(): IterableIterator<unknown>;
};

function oxigraphBindingRecord(binding: OxigraphBinding): string {
  const record: Record<string, CanonicalTerm> = {};
  for (const key of binding.keys()) {
    const name = typeof key === "string"
      ? key
      : (key as { value: string }).value;
    const term = binding.get(name) as rdfjs.Term | undefined;
    if (term !== undefined && term !== null) {
      record[name] = canonicalizeRdfTerm(term);
    }
  }
  return bindingRecord(record);
}

// ---------------------------------------------------------------------------
// Query generation: 13 families, templates with random slots.
// No generated query text existed in the repo before this run.
// ---------------------------------------------------------------------------

type GeneratedQuery = {
  family: string;
  kind: "select" | "ask" | "construct";
  query: string;
  ordered: boolean;
};

const PERSON = "?person";
const FRIEND = "?friend";
const NAME = "?name";
const AGE = "?age";
const SCORE = "?score";
const CITY = "?city";

function personIri(): string {
  return exIri(`person${intBetween(0, PERSON_COUNT - 1)}`);
}

function cityLiteral(): string {
  return `"${pick(CITIES)}"`;
}

function nameLiteral(): string {
  return `"${pick(FIRST_NAMES)}"`;
}

function tagLiteral(): string {
  return `"${pick(TAGS)}"`;
}

function ageThreshold(): number {
  return intBetween(25, 65);
}

function scoreThreshold(): number {
  return intBetween(20, 90);
}

const BGP_PATTERNS: readonly string[] = [
  `${PERSON} ${exIri("name")} ${NAME}`,
  `${PERSON} ${exIri("age")} ${AGE}`,
  `${PERSON} ${exIri("score")} ${SCORE}`,
  `${PERSON} ${exIri("city")} ${CITY}`,
  `${PERSON} ${exIri("knows")} ${FRIEND}`,
  `${PERSON} ${exIri("tag")} ?tag`,
  `${PERSON} ${exIri("nick")} ?nick`,
];

function randomBgp(count: number): string {
  return pickN(BGP_PATTERNS, count).join(" . ");
}

function projectVars(vars: string[]): string {
  return vars.join(" ");
}

function generateBgp(): GeneratedQuery {
  const count = intBetween(1, 3);
  const patterns = randomBgp(count);
  const vars = [PERSON];
  if (patterns.includes(NAME)) vars.push(NAME);
  if (patterns.includes(AGE)) vars.push(AGE);
  if (patterns.includes(SCORE)) vars.push(SCORE);
  if (patterns.includes(CITY)) vars.push(CITY);
  if (patterns.includes(FRIEND)) vars.push(FRIEND);
  if (patterns.includes("?tag")) vars.push("?tag");
  if (patterns.includes("?nick")) vars.push("?nick");
  return {
    family: "bgp",
    kind: "select",
    query: `SELECT ${projectVars(vars)} WHERE { ${patterns} }`,
    ordered: false,
  };
}

function generateJoinChain(): GeneratedQuery {
  const template = pick([
    {
      chain: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("name")
      } ${NAME}`,
      vars: [PERSON, FRIEND, NAME],
    },
    {
      chain: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("knows")
      } ?second . ?second ${exIri("name")} ${NAME}`,
      vars: [PERSON, FRIEND, "?second", NAME],
    },
    {
      chain: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("city")
      } ${CITY}`,
      vars: [PERSON, FRIEND, CITY],
    },
    {
      chain: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("age")
      } ${AGE}`,
      vars: [PERSON, FRIEND, AGE],
    },
    {
      chain: `${personIri()} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("name")
      } ${NAME}`,
      vars: [FRIEND, NAME],
    },
    {
      chain: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("knows")
      } ?second . ?second ${exIri("score")} ${SCORE}`,
      vars: [PERSON, FRIEND, "?second", SCORE],
    },
  ]);
  return {
    family: "join-chain",
    kind: "select",
    query: `SELECT ${projectVars(template.vars)} WHERE { ${template.chain} }`,
    ordered: false,
  };
}

function generateOptional(): GeneratedQuery {
  const optionalPattern = pick([
    `OPTIONAL { ${PERSON} ${exIri("tag")} ?tag }`,
    `OPTIONAL { ${PERSON} ${exIri("knows")} ${FRIEND} }`,
    `OPTIONAL { ${PERSON} ${exIri("nick")} ?nick }`,
    `OPTIONAL { ${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
      exIri("name")
    } ?friendName }`,
    `OPTIONAL { ${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
      exIri("city")
    } ?friendCity }`,
    `OPTIONAL { ${PERSON} ${
      exIri("tag")
    } ?tag . FILTER(?tag = ${tagLiteral()}) }`,
  ]);
  const vars = [PERSON, NAME, AGE];
  if (optionalPattern.includes("?tag")) vars.push("?tag");
  if (optionalPattern.includes(FRIEND)) vars.push(FRIEND);
  if (optionalPattern.includes("?nick")) vars.push("?nick");
  if (optionalPattern.includes("?friendName")) vars.push("?friendName");
  if (optionalPattern.includes("?friendCity")) vars.push("?friendCity");
  return {
    family: "optional",
    kind: "select",
    query: `SELECT ${projectVars(vars)} WHERE { ${PERSON} ${
      exIri("name")
    } ${NAME} . ${PERSON} ${exIri("age")} ${AGE} . ${optionalPattern} }`,
    ordered: false,
  };
}

function generateUnion(): GeneratedQuery {
  const left = pick([
    `${PERSON} ${exIri("city")} ${cityLiteral()}`,
    `${PERSON} ${exIri("tag")} ${tagLiteral()}`,
    `${PERSON} ${exIri("age")} ${AGE} . FILTER(${AGE} > ${ageThreshold()})`,
  ]);
  const right = pick([
    `${PERSON} ${exIri("city")} ${cityLiteral()}`,
    `${PERSON} ${exIri("tag")} ${tagLiteral()}`,
    `${PERSON} ${exIri("name")} ${nameLiteral()}`,
  ]);
  return {
    family: "union",
    kind: "select",
    query: `SELECT ${PERSON} WHERE { { ${left} } UNION { ${right} } }`,
    ordered: false,
  };
}

function generateMinus(): GeneratedQuery {
  const excluded = pick([
    `${PERSON} ${exIri("city")} ${cityLiteral()}`,
    `${PERSON} ${exIri("tag")} ${tagLiteral()}`,
    `${PERSON} ${exIri("age")} ${AGE} . FILTER(${AGE} < ${ageThreshold()})`,
  ]);
  return {
    family: "minus",
    kind: "select",
    query: `SELECT ${PERSON} ${NAME} WHERE { ${PERSON} ${
      exIri("name")
    } ${NAME} MINUS { ${excluded} } }`,
    ordered: false,
  };
}

function generateFilterNumeric(): GeneratedQuery {
  const threshold = pick([ageThreshold(), scoreThreshold()]);
  const variable = random() < 0.5 ? AGE : SCORE;
  const predicate = variable === AGE ? "age" : "score";
  const operator = pick([">", "<", ">=", "<=", "=", "!="]);
  const extra = random() < 0.4
    ? ` && ${variable} ${pick([">", "<"])} ${intBetween(0, 40)}`
    : "";
  return {
    family: "filter-numeric",
    kind: "select",
    query: `SELECT ${PERSON} ${NAME} ${variable} WHERE { ${PERSON} ${
      exIri("name")
    } ${NAME} . ${PERSON} ${
      exIri(predicate)
    } ${variable} . FILTER(${variable} ${operator} ${threshold}${extra}) }`,
    ordered: false,
  };
}

function generateFilterString(): GeneratedQuery {
  const template = pick([
    `FILTER(STRSTARTS(${NAME}, "${pick(FIRST_NAMES)[0]}"))`,
    `FILTER(CONTAINS(LCASE(${NAME}), "${pick(FIRST_NAMES).toLowerCase()}"))`,
    `FILTER(REGEX(${NAME}, "^${pick(FIRST_NAMES)[0]}", "i"))`,
    `FILTER(STRLEN(${NAME}) ${pick([">", "<=", "="])} ${intBetween(2, 5)})`,
    `FILTER(UCASE(${NAME}) = "${pick(FIRST_NAMES).toUpperCase()}")`,
    `FILTER(LANG(?nick) = "en")`,
  ]);
  const patterns = template.includes("?nick")
    ? `${PERSON} ${exIri("name")} ${NAME} . ${PERSON} ${exIri("nick")} ?nick`
    : `${PERSON} ${exIri("name")} ${NAME}`;
  const vars = template.includes("?nick")
    ? [PERSON, NAME, "?nick"]
    : [PERSON, NAME];
  return {
    family: "filter-string",
    kind: "select",
    query: `SELECT ${projectVars(vars)} WHERE { ${patterns} . ${template} }`,
    ordered: false,
  };
}

function generateBindValues(): GeneratedQuery {
  const template = pick([
    {
      where: `${PERSON} ${exIri("age")} ${AGE} . BIND(${AGE} * 2 AS ?double)`,
      vars: [PERSON, AGE, "?double"],
    },
    {
      where: `${PERSON} ${exIri("age")} ${AGE} . ${PERSON} ${
        exIri("score")
      } ${SCORE} . BIND(${AGE} + ${SCORE} AS ?total)`,
      vars: [PERSON, AGE, SCORE, "?total"],
    },
    {
      where: `${PERSON} ${
        exIri("age")
      } ${AGE} . BIND(IF(${AGE} > ${ageThreshold()}, "senior", "junior") AS ?band)`,
      vars: [PERSON, AGE, "?band"],
    },
    {
      where: `${PERSON} ${
        exIri("name")
      } ${NAME} . BIND(STRLEN(${NAME}) AS ?nameLength)`,
      vars: [PERSON, NAME, "?nameLength"],
    },
    {
      where: `${PERSON} ${
        exIri("name")
      } ${NAME} . VALUES ${PERSON} { ${personIri()} ${personIri()} }`,
      vars: [PERSON, NAME],
    },
    {
      where: `${PERSON} ${
        exIri("city")
      } ${CITY} . VALUES ${CITY} { ${cityLiteral()} ${cityLiteral()} }`,
      vars: [PERSON, CITY],
    },
    {
      where: `${PERSON} ${
        exIri("age")
      } ${AGE} . BIND(ABS(${AGE} - 40) AS ?distance)`,
      vars: [PERSON, AGE, "?distance"],
    },
    {
      where: `${PERSON} ${
        exIri("name")
      } ${NAME} . BIND(CONCAT(${NAME}, " Jr.") AS ?formal)`,
      vars: [PERSON, NAME, "?formal"],
    },
    {
      where: `${PERSON} ${
        exIri("score")
      } ${SCORE} . BIND(${SCORE} - ${SCORE} AS ?zero)`,
      vars: [PERSON, SCORE, "?zero"],
    },
  ]);
  return {
    family: "bind-values",
    kind: "select",
    query: `SELECT ${projectVars(template.vars)} WHERE { ${template.where} }`,
    ordered: false,
  };
}

function generateAggregate(): GeneratedQuery {
  const countThreshold = intBetween(3, 8);
  const distinctThreshold = intBetween(2, 4);
  const template = pick([
    {
      select: `${CITY} (COUNT(${PERSON}) AS ?count)`,
      group: CITY,
      having: `COUNT(?person) > ${countThreshold}`,
    },
    {
      select: `${CITY} (SUM(${AGE}) AS ?ageTotal) (COUNT(${PERSON}) AS ?count)`,
      group: CITY,
      having: `COUNT(?person) > ${countThreshold}`,
    },
    {
      select: `${CITY} (MIN(${AGE}) AS ?youngest) (MAX(${AGE}) AS ?oldest)`,
      group: CITY,
      having: `COUNT(?person) > ${countThreshold}`,
    },
    {
      select: `${CITY} (COUNT(DISTINCT ${NAME}) AS ?names)`,
      group: CITY,
      having: `COUNT(DISTINCT ?name) > ${distinctThreshold}`,
    },
    {
      select: `${CITY} (MIN(${SCORE}) AS ?low) (MAX(${SCORE}) AS ?high)`,
      group: CITY,
      having: `COUNT(?person) > ${countThreshold}`,
    },
    {
      select: `${CITY} (SUM(${SCORE}) AS ?scoreTotal)`,
      group: CITY,
      having: `SUM(?score) > ${intBetween(200, 600)}`,
    },
  ]);
  return {
    family: "aggregate",
    kind: "select",
    query: `SELECT ${template.select} WHERE { ${PERSON} ${
      exIri("city")
    } ${CITY} . ${PERSON} ${exIri("age")} ${AGE} . ${PERSON} ${
      exIri("name")
    } ${NAME} . ${PERSON} ${
      exIri("score")
    } ${SCORE} } GROUP BY ${template.group} HAVING(${template.having})`,
    ordered: false,
  };
}

function generateOrderLimit(): GeneratedQuery {
  const limit = pick([5, 10, 15]);
  const offset = pick([0, 3, 7]);
  const direction = pick(["ASC", "DESC"]);
  const orderVariable = pick([AGE, NAME, SCORE]);
  // Dedupe the sort keys: a repeated key in ORDER BY is legal SPARQL but
  // adds nothing to a total order, so keep the key list minimal.
  const orderKeys = [orderVariable, NAME, AGE, PERSON].filter(
    (variable, index, list) => list.indexOf(variable) === index,
  );
  const order = direction === "ASC"
    ? orderKeys.join(" ")
    : `DESC(${orderVariable}) ${orderKeys.slice(1).join(" ")}`;
  return {
    family: "order-limit",
    kind: "select",
    query:
      `SELECT DISTINCT ${PERSON} ${NAME} ${AGE} ${SCORE} WHERE { ${PERSON} ${
        exIri("name")
      } ${NAME} . ${PERSON} ${exIri("age")} ${AGE} . ${PERSON} ${
        exIri("score")
      } ${SCORE} } ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    ordered: true,
  };
}

function generatePath(): GeneratedQuery {
  const template = pick([
    `${PERSON} ${exIri("knows")}/${exIri("knows")} ${FRIEND}`,
    `${PERSON} ^${exIri("knows")} ${FRIEND}`,
    `${PERSON} ${exIri("knows")}+ ${FRIEND}`,
    `${PERSON} ${exIri("knows")}* ${FRIEND}`,
    `${PERSON} (${exIri("knows")}|${exIri("tag")}) ?target`,
    // Alternation with identical branches: a union of multisets, so each
    // friend must appear twice. Catches dedup in the | case.
    `${PERSON} (${exIri("knows")}|${exIri("knows")}) ${FRIEND}`,
    `${PERSON} ^${exIri("knows")}/${exIri("knows")} ${FRIEND}`,
    `${PERSON} ${exIri("knows")}+/${exIri("city")} ${CITY}`,
    `${PERSON} ^${exIri("knows")}+ ${FRIEND}`,
    `${PERSON} ${exIri("knows")}/${exIri("city")} ${CITY}`,
  ]);
  const vars = template.includes("?target")
    ? [PERSON, "?target"]
    : template.includes(CITY)
    ? [PERSON, CITY]
    : [PERSON, FRIEND];
  return {
    family: "path",
    kind: "select",
    query: `SELECT ${projectVars(vars)} WHERE { ${template} }`,
    ordered: false,
  };
}

function generateAsk(): GeneratedQuery {
  const template = pick([
    `ASK WHERE { ${personIri()} ${exIri("knows")} ${personIri()} }`,
    `ASK WHERE { ${PERSON} ${exIri("city")} ${cityLiteral()} . ${PERSON} ${
      exIri("age")
    } ${AGE} . FILTER(${AGE} > ${ageThreshold()}) }`,
    `ASK WHERE { ${PERSON} ${exIri("tag")} ${tagLiteral()} }`,
    `ASK WHERE { ${PERSON} ${exIri("name")} ${nameLiteral()} . ${PERSON} ${
      exIri("score")
    } ${SCORE} . FILTER(${SCORE} >= ${scoreThreshold()}) }`,
  ]);
  return { family: "ask", kind: "ask", query: template, ordered: false };
}

function generateConstruct(): GeneratedQuery {
  const template = pick([
    {
      template: `${PERSON} ${exIri("score")} ${SCORE}`,
      where: `${PERSON} ${
        exIri("score")
      } ${SCORE} . FILTER(${SCORE} > ${scoreThreshold()})`,
    },
    {
      template: `${PERSON} ${exIri("city")} ${CITY}`,
      where: `${PERSON} ${exIri("city")} ${CITY} . ${PERSON} ${
        exIri("age")
      } ${AGE} . FILTER(${AGE} >= ${ageThreshold()})`,
    },
    {
      template: `${PERSON} ${exIri("knows")} ${FRIEND}`,
      where: `${PERSON} ${exIri("knows")} ${FRIEND} . ${FRIEND} ${
        exIri("city")
      } ${cityLiteral()}`,
    },
  ]);
  return {
    family: "construct",
    kind: "construct",
    query: `CONSTRUCT { ${template.template} } WHERE { ${template.where} }`,
    ordered: false,
  };
}

const GENERATORS: readonly (() => GeneratedQuery)[] = [
  generateBgp,
  generateJoinChain,
  generateOptional,
  generateUnion,
  generateMinus,
  generateFilterNumeric,
  generateFilterString,
  generateBindValues,
  generateAggregate,
  generateOrderLimit,
  generatePath,
  generateAsk,
  generateConstruct,
];

function generateQueries(): GeneratedQuery[] {
  const queries: GeneratedQuery[] = [];
  for (const generator of GENERATORS) {
    for (let index = 0; index < PER_FAMILY; index++) {
      queries.push(generator());
    }
  }
  return queries;
}

// ---------------------------------------------------------------------------
// Engine runners: each returns canonical records, or an error string.
// ---------------------------------------------------------------------------

type EngineResult =
  | { ok: true; records: string[] }
  | { ok: false; error: string };

function dedupe(records: string[]): string[] {
  return [...new Set(records)];
}

function sortRecords(records: string[]): string[] {
  return [...records].sort();
}

function compareRecords(
  first: string[],
  second: string[],
): string | null {
  if (first.length !== second.length) {
    return `count mismatch: ${first.length} vs ${second.length}`;
  }
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) {
      return `first difference at sorted index ${index}:\n` +
        `  A: ${first[index]}\n  B: ${second[index]}`;
    }
  }
  return null;
}

async function runWazoo(
  generated: GeneratedQuery,
): Promise<EngineResult> {
  try {
    const response = await wazooEngine.execute({ query: generated.query });
    if (generated.kind === "select") {
      if (response.kind !== "select") {
        return { ok: false, error: `returned ${response.kind}` };
      }
      const records = response.data.results.bindings.map((binding) => {
        const record: Record<string, CanonicalTerm> = {};
        for (const name of Object.keys(binding)) {
          record[name] = canonicalizeSparqlValue(binding[name]);
        }
        return bindingRecord(record);
      });
      return {
        ok: true,
        records: generated.ordered ? records : sortRecords(records),
      };
    }
    if (generated.kind === "ask") {
      if (response.kind !== "ask") {
        return { ok: false, error: `returned ${response.kind}` };
      }
      return { ok: true, records: [String(response.data.boolean)] };
    }
    if (response.kind !== "construct") {
      return { ok: false, error: `returned ${response.kind}` };
    }
    return {
      ok: true,
      records: sortRecords(
        response.data.quads.map((item) =>
          quadRecord(item, canonicalizeRdfTerm)
        ),
      ),
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

async function runComunica(
  generated: GeneratedQuery,
): Promise<EngineResult> {
  try {
    if (generated.kind === "select") {
      const rawBindings = await runComunicaRawSelectBindings(
        comunicaEngine,
        generated.query,
        comunicaStore,
      );
      const records = rawBindings.map((binding) => {
        const record: Record<string, CanonicalTerm> = {};
        for (const name of Object.keys(binding)) {
          record[name] = canonicalizeComunicaTerm(binding[name]);
        }
        return bindingRecord(record);
      });
      return {
        ok: true,
        records: generated.ordered ? records : sortRecords(records),
      };
    }
    if (generated.kind === "ask") {
      const boolean = await comunicaEngine.queryBoolean(generated.query, {
        sources: [comunicaStore],
      });
      return { ok: true, records: [String(boolean)] };
    }
    const stream = await comunicaEngine.queryQuads(generated.query, {
      sources: [comunicaStore],
    });
    const quads = await stream.toArray();
    const records = quads.map((item) => {
      const parts = [item.subject, item.predicate, item.object, item.graph]
        .map((term) => JSON.stringify(canonicalizeComunicaTerm(term)));
      return parts.join(" ");
    });
    return { ok: true, records: sortRecords(dedupe(records)) };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

function runOxigraph(generated: GeneratedQuery): EngineResult {
  try {
    if (generated.kind === "select") {
      const bindings = oxigraphStore.query(
        generated.query,
      ) as unknown as OxigraphBinding[];
      const records = bindings.map(oxigraphBindingRecord);
      return {
        ok: true,
        records: generated.ordered ? records : sortRecords(records),
      };
    }
    if (generated.kind === "ask") {
      const boolean = oxigraphStore.query(generated.query) as boolean;
      return { ok: true, records: [String(boolean)] };
    }
    const quads = oxigraphStore.query(
      generated.query,
    ) as unknown as rdfjs.Quad[];
    const records = quads.map((item) => quadRecord(item, canonicalizeRdfTerm));
    return { ok: true, records: sortRecords(dedupe(records)) };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Main: run every generated query through all three engines.
// ---------------------------------------------------------------------------

type Verdict =
  | "agree-all"
  | "wazoo-comunica-vs-oxigraph"
  | "wazoo-oxigraph-vs-comunica"
  | "comunica-oxigraph-vs-wazoo"
  | "all-differ"
  | "error";

type CaseResult = {
  index: number;
  family: string;
  kind: string;
  query: string;
  verdict: Verdict;
  detail: string | null;
  wazooError: string | null;
  comunicaError: string | null;
  oxigraphError: string | null;
  wazooCount: number | null;
  comunicaCount: number | null;
  oxigraphCount: number | null;
};

function classify(
  wazoo: EngineResult,
  comunica: EngineResult,
  oxigraph: EngineResult,
  ordered: boolean,
): { verdict: Verdict; detail: string | null } {
  if (!wazoo.ok || !comunica.ok || !oxigraph.ok) {
    return { verdict: "error", detail: null };
  }
  // Ordered queries: wazoo's order is checked against Oxigraph only.
  // Comunica's ORDER BY output is not reliably sorted (see the header
  // note), so Comunica pairs are compared as multisets even here.
  const multiset = (first: string[], second: string[]) =>
    compareRecords(sortRecords(first), sortRecords(second));
  const wazooComunica = ordered
    ? multiset(wazoo.records, comunica.records)
    : compareRecords(
      sortRecords(wazoo.records),
      sortRecords(comunica.records),
    );
  const wazooOxigraph = ordered
    ? compareRecords(wazoo.records, oxigraph.records)
    : compareRecords(
      sortRecords(wazoo.records),
      sortRecords(oxigraph.records),
    );
  const comunicaOxigraph = ordered
    ? multiset(comunica.records, oxigraph.records)
    : compareRecords(
      sortRecords(comunica.records),
      sortRecords(oxigraph.records),
    );
  if (
    wazooComunica === null && wazooOxigraph === null &&
    comunicaOxigraph === null
  ) {
    return { verdict: "agree-all", detail: null };
  }
  if (wazooComunica === null) {
    return {
      verdict: "wazoo-comunica-vs-oxigraph",
      detail: wazooOxigraph ?? comunicaOxigraph,
    };
  }
  if (wazooOxigraph === null) {
    return {
      verdict: "wazoo-oxigraph-vs-comunica",
      detail: wazooComunica ?? comunicaOxigraph,
    };
  }
  if (comunicaOxigraph === null) {
    return {
      verdict: "comunica-oxigraph-vs-wazoo",
      detail: wazooComunica ?? wazooOxigraph,
    };
  }
  return {
    verdict: "all-differ",
    detail: wazooComunica ?? wazooOxigraph ?? comunicaOxigraph,
  };
}

const generatedQueries = generateQueries();
const seenQueries = new Set<string>();
const uniqueQueries = generatedQueries.filter((generated) => {
  if (seenQueries.has(generated.query)) return false;
  seenQueries.add(generated.query);
  return true;
});

console.log(
  `Held-out differential fuzz — seed ${SEED}, dataset ${dataset.length} quads, ` +
    `${uniqueQueries.length} unique queries ` +
    `(${generatedQueries.length - uniqueQueries.length} duplicates removed).`,
);
console.log("Engines: wazoo (local checkout) vs Comunica vs Oxigraph.");
console.log("No engine source is modified by this script.");

const results: CaseResult[] = [];
const startedAt = Date.now();
for (let index = 0; index < uniqueQueries.length; index++) {
  const generated = uniqueQueries[index];
  const wazoo = await runWazoo(generated);
  const comunica = await runComunica(generated);
  const oxigraph = runOxigraph(generated);
  const { verdict, detail } = classify(
    wazoo,
    comunica,
    oxigraph,
    generated.ordered,
  );
  results.push({
    index,
    family: generated.family,
    kind: generated.kind,
    query: generated.query,
    verdict,
    detail,
    wazooError: wazoo.ok ? null : wazoo.error,
    comunicaError: comunica.ok ? null : comunica.error,
    oxigraphError: oxigraph.ok ? null : oxigraph.error,
    wazooCount: wazoo.ok ? wazoo.records.length : null,
    comunicaCount: comunica.ok ? comunica.records.length : null,
    oxigraphCount: oxigraph.ok ? oxigraph.records.length : null,
  });
  if ((index + 1) % 50 === 0) {
    console.log(`  ... ${index + 1}/${uniqueQueries.length} queries run`);
  }
}
const elapsedMs = Date.now() - startedAt;

const byVerdict = new Map<Verdict, number>();
for (const result of results) {
  byVerdict.set(result.verdict, (byVerdict.get(result.verdict) ?? 0) + 1);
}
const agreeAll = byVerdict.get("agree-all") ?? 0;
const byFamily = new Map<string, { total: number; agree: number }>();
for (const result of results) {
  const entry = byFamily.get(result.family) ?? { total: 0, agree: 0 };
  entry.total += 1;
  if (result.verdict === "agree-all") entry.agree += 1;
  byFamily.set(result.family, entry);
}

console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s.`);
console.log(
  `Agree-all: ${agreeAll}/${results.length} ` +
    `(${(100 * agreeAll / results.length).toFixed(1)}%)`,
);
for (const [verdict, count] of [...byVerdict.entries()].sort()) {
  if (verdict !== "agree-all") console.log(`  ${verdict}: ${count}`);
}
console.log("\nPer family (agree / total):");
for (const [family, entry] of [...byFamily.entries()].sort()) {
  console.log(`  ${family}: ${entry.agree}/${entry.total}`);
}

const mismatches = results.filter((result) => result.verdict !== "agree-all");
if (mismatches.length > 0) {
  console.log(`\n--- Mismatches (${mismatches.length}) ---`);
  for (const mismatch of mismatches) {
    console.log(
      `\n[${mismatch.index}] ${mismatch.family} / ${mismatch.kind} / ${mismatch.verdict}`,
    );
    console.log(`  query: ${mismatch.query}`);
    if (mismatch.detail) console.log(`  ${mismatch.detail}`);
    console.log(
      `  counts wazoo=${mismatch.wazooCount} comunica=${mismatch.comunicaCount} oxigraph=${mismatch.oxigraphCount}`,
    );
    if (mismatch.wazooError) {
      console.log(`  wazoo error: ${mismatch.wazooError}`);
    }
    if (mismatch.comunicaError) {
      console.log(`  comunica error: ${mismatch.comunicaError}`);
    }
    if (mismatch.oxigraphError) {
      console.log(`  oxigraph error: ${mismatch.oxigraphError}`);
    }
  }
} else {
  console.log("\nNo mismatches.");
}

const report = {
  seed: SEED,
  perFamilyRequested: PER_FAMILY,
  datasetQuads: dataset.length,
  personCount: PERSON_COUNT,
  totalQueries: results.length,
  agreeAll,
  byVerdict: Object.fromEntries(byVerdict),
  byFamily: Object.fromEntries(byFamily),
  elapsedMs,
  mismatches,
};
await Deno.writeTextFile(
  new URL("./heldout-fuzz-report.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log("\nReport written to bench/heldout-fuzz-report.json");

// The CI gate: fail only when wazoo is the lone outlier — both reference
// engines agree with each other and disagree with wazoo
// ("comunica-oxigraph-vs-wazoo"), when all three disagree, or on an engine
// error. A mismatch where wazoo agrees with one reference engine is a
// reference-engine divergence (e.g. Comunica's ORDER BY slips), reported
// above but not a wazoo regression, so it does not fail the gate.
function failsGate(verdict: Verdict): boolean {
  return verdict === "comunica-oxigraph-vs-wazoo" ||
    verdict === "all-differ" || verdict === "error";
}
const gateFailures = mismatches.filter((result) => failsGate(result.verdict));
if (gateFailures.length > 0) {
  console.log(
    `\nGate FAILED: ${gateFailures.length} mismatch(es) where wazoo is the lone outlier.`,
  );
  Deno.exit(1);
} else {
  console.log("\nGate passed: wazoo was never the lone outlier.");
}

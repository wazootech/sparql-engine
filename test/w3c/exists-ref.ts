import * as oxigraph from "oxigraph";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

/**
 * EXISTS surface cross-check: the native engine must agree with Oxigraph on
 * subqueries inside EXISTS/NOT EXISTS.
 *
 * The EXISTS evaluator (src/evaluator/bgp-evaluator.ts) evaluates subqueries
 * over the graph-scoped candidate snapshot, then runs the shared select
 * pipeline (src/evaluator/select-pipeline.ts). The in-repo regression tests
 * assert native semantics; this gate cross-validates them against an
 * independent SPARQL 1.1 engine — Oxigraph (Rust/WASM) — so a future change
 * that quietly breaks subquery-in-EXISTS evaluation fails CI even if the
 * unit tests are updated to match. Every case projects one variable; the
 * comparison is over the sorted set of projected values.
 *
 * This mirrors the earlier probe-driven validation (native = Oxigraph on all
 * 9 cases, SPARQL 1.1 §18.2.4 non-correlation included) and keeps it
 * repeatable. Comunica's lite engine is deliberately not an oracle here: it
 * correlates subqueries with outer bindings (wrong per §18.2.4) and
 * duplicates rows, so it cannot gate this surface.
 *
 * Run with:  deno task test:exists-ref
 */

const BASE = "http://example.org/base";

/** Dataset shared by both engines, as Turtle (loaded by Oxigraph) and as
 * RDF/JS quads (built into the native MemoryStore). */
const TURTLE = `
@prefix ex: <http://example.org/> .
ex:s ex:p ex:a .
ex:t ex:p ex:b .
ex:u ex:p ex:c .
ex:s ex:q "x" .
ex:t ex:q "y" .
ex:s ex:r ex:z .
`;

interface Case {
  name: string;
  query: string;
}

/** Projected-variable expected values are implied by the subquery semantics;
 * the gate compares native vs Oxigraph, not against a hardcoded list. */
const CASES: Case[] = [
  {
    name: "basic",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w } } }",
  },
  {
    name: "not-exists",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER NOT EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w . " +
      "?x <http://example.org/z> ?zz } } }",
  },
  {
    name: "aggregate-having",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { ?x <http://example.org/q> ?w } " +
      "HAVING (COUNT(?x) >= 2) } }",
  },
  {
    name: "distinct",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT DISTINCT ?x WHERE { ?x <http://example.org/q> ?w } } }",
  },
  {
    name: "projection-expr",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT (UCASE(?w) AS ?u) WHERE { ?x <http://example.org/q> ?w " +
      'FILTER (UCASE(?w) = "X") } } }',
  },
  {
    // SPARQL 1.1 §18.2.4: subqueries evaluate independently, so the inner
    // FILTER referencing the outer ?s is unbound and the EXISTS is false.
    name: "non-correlation",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w . " +
      "FILTER(?x = ?s) } } }",
  },
  {
    name: "order-limit",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT ?x WHERE { ?x <http://example.org/q> ?w } " +
      "ORDER BY DESC(?w) LIMIT 1 } }",
  },
  {
    name: "union-in-subquery",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT ?x WHERE { { ?x <http://example.org/q> ?w } " +
      "UNION { ?x <http://example.org/p> ?w } } } }",
  },
  {
    name: "group-by",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT ?x (COUNT(?w) AS ?c) WHERE { ?x <http://example.org/q> ?w } " +
      "GROUP BY ?x } }",
  },
  {
    // NOT EXISTS nested inside an EXISTS subquery. The inner FILTER NOT
    // EXISTS correlates with the subquery's own ?x: ex:s has an r edge so it
    // is filtered out, ex:t survives. HAVING pins the surviving count to 1;
    // if a change stops evaluating the nested NOT EXISTS, the count becomes
    // 2, the EXISTS turns false, and every outer row diverges.
    name: "not-exists-inside-exists",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { " +
      "?x <http://example.org/q> ?w . " +
      "FILTER NOT EXISTS { ?x <http://example.org/r> ?z } } " +
      "HAVING (COUNT(?x) = 1) } }",
  },
  {
    // EXISTS nested inside an EXISTS subquery. The inner FILTER EXISTS
    // requires an r edge, so only ex:s survives (ex:t has none); HAVING pins
    // the count to 1. Treating the nested EXISTS as always true yields count
    // 2 and an empty EXISTS, failing every outer row.
    name: "nested-exists",
    query: "SELECT ?s WHERE { ?s <http://example.org/p> ?v " +
      "FILTER EXISTS { SELECT (COUNT(?x) AS ?c) WHERE { " +
      "?x <http://example.org/q> ?w . " +
      "FILTER EXISTS { ?x <http://example.org/r> ?z } } " +
      "HAVING (COUNT(?x) = 1) } }",
  },
];

const { namedNode, literal, quad } = DataFactory;

function nativeStore(): Store {
  const store = new Store();
  const ex = (local: string) => namedNode(`http://example.org/${local}`);
  const add = (s: string, p: string, o: string) =>
    store.addQuad(quad(ex(s), ex(p), ex(o)));
  add("s", "p", "a");
  add("t", "p", "b");
  add("u", "p", "c");
  store.addQuad(quad(ex("s"), ex("q"), literal("x")));
  store.addQuad(quad(ex("t"), ex("q"), literal("y")));
  // ex:s has an r edge, ex:t does not — the nested EXISTS/NOT EXISTS cases
  // below rely on this to filter subquery rows, so a future change that
  // stops evaluating nested filters flips the HAVING count and diverges.
  store.addQuad(quad(ex("s"), ex("r"), ex("z")));
  return store;
}

/** Native: project a variable from the SELECT results, sorted. */
async function nativeProjected(
  query: string,
  variable: string,
): Promise<string[]> {
  const engine = new WazooSparqlEngine({ store: nativeStore() });
  const result = await engine.execute({ query });
  if (result.kind !== "select") {
    throw new Error(`expected select, got ${result.kind}`);
  }
  return result.data.results.bindings.map((b) =>
    String((b[variable] as { value: string }).value)
  ).sort();
}

/** Oxigraph: query a fresh store loaded from the shared Turtle text. */
function oxigraphProjected(query: string, variable: string): string[] {
  const store = new oxigraph.Store();
  store.load(TURTLE, { format: "text/turtle", base_iri: BASE });
  // The wasm bindings read `media_type` (the TS types are stale and only
  // advertise `results_format`); without it the query returns raw terms.
  const rows = store.query(query, {
    media_type: "application/sparql-results+json",
  } as never) as ArrayLike<Map<string, { termType: string; value: string }>>;
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const term = rows[i].get(variable);
    if (term) out.push(term.value);
  }
  return out.sort();
}

let failures = 0;
console.log("case | native | oxigraph | verdict");
console.log("-".repeat(72));
for (const c of CASES) {
  const native = await nativeProjected(c.query, "s");
  const oxi = oxigraphProjected(c.query, "s");
  const pass = JSON.stringify(native) === JSON.stringify(oxi);
  if (!pass) failures++;
  console.log(
    `${c.name} | [${native.join(", ")}] | [${oxi.join(", ")}] | ` +
      `${pass ? "pass" : "DIVERGE"}`,
  );
}

console.log(`\n${CASES.length} EXISTS-subquery case(s) cross-checked.`);
if (failures > 0) {
  console.error(
    `\nCross-check FAILED: native diverges from Oxigraph on ${failures} ` +
      `case(s). Fix the EXISTS evaluator or the select pipeline before ` +
      `touching the queries.\n`,
  );
  Deno.exit(1);
}
console.log(
  "\nCross-check passed: native agrees with Oxigraph on every subquery-in-" +
    "EXISTS case, including §18.2.4 non-correlation.",
);

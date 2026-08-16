import { assertEquals } from "@std/assert";
import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import type { ScanEntry, TermBinding } from "@/evaluator/join.ts";
import { BaselineJoinCostEstimator } from "@/planner/join-cost-estimator.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { JoinCostEstimator } from "@/planner/join-cost-estimator.ts";
import type { Term as SparqlTerm } from "@/parser/sparql-parser.ts";

const { namedNode, variable, quad } = DataFactory;

/** candidateQuads returns an array of n distinct candidate quads. */
function candidateQuads(count: number): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < count; index++) {
    quads.push(
      quad(
        namedNode(`http://example.org/s${index}`),
        namedNode(`http://example.org/p`),
        namedNode(`http://example.org/o${index}`),
      ),
    );
  }
  return quads;
}

/** entry builds a ScanEntry for the given pattern positions and candidates. */
function entry(
  subject: SparqlTerm,
  predicate: SparqlTerm,
  object: SparqlTerm,
  candidates: rdfjs.Quad[],
): ScanEntry {
  return { subject, predicate, object, candidates };
}

const patternVar = variable("x");
const otherVar = variable("y");
const constant = namedNode("http://example.org/constant");
const baseline = new BaselineJoinCostEstimator();

Deno.test("BaselineJoinCostEstimator - empty bindings cost zero", () => {
  const cost = baseline.estimateJoinCost(
    entry(patternVar, constant, otherVar, candidateQuads(100)),
    [],
  );
  assertEquals(cost, 0);
});

Deno.test(
  "BaselineJoinCostEstimator - no bound pattern variable iterates every candidate",
  () => {
    // Both pattern variables are unbound in every binding.
    const bindings: TermBinding[] = [{ a: namedNode("http://example.org/a") }];
    const cost = baseline.estimateJoinCost(
      entry(patternVar, constant, otherVar, candidateQuads(50)),
      bindings,
    );
    assertEquals(cost, 50);
  },
);

Deno.test(
  "BaselineJoinCostEstimator - bound variable costs bindings times the average bucket",
  () => {
    // One bound pattern variable with 2 distinct values across 4 bindings:
    // bucket = candidates / distinct = 100 / 2 = 50.
    const bindings: TermBinding[] = [
      { x: namedNode("http://example.org/v1") },
      { x: namedNode("http://example.org/v2") },
      { x: namedNode("http://example.org/v1") },
      { x: namedNode("http://example.org/v2") },
    ];
    const cost = baseline.estimateJoinCost(
      entry(patternVar, constant, otherVar, candidateQuads(100)),
      bindings,
    );
    assertEquals(cost, 4 * 50);
  },
);

Deno.test(
  "BaselineJoinCostEstimator - duplicate bound values widen the bucket",
  () => {
    // The same 4 bindings all carrying one distinct value: bucket = 100 / 1.
    const bindings: TermBinding[] = Array.from({ length: 4 }, () => ({
      x: namedNode("http://example.org/v1"),
    }));
    const cost = baseline.estimateJoinCost(
      entry(patternVar, constant, otherVar, candidateQuads(100)),
      bindings,
    );
    assertEquals(cost, 4 * 100);
  },
);

Deno.test(
  "BaselineJoinCostEstimator - the fewest-distinct bound variable bounds the cost",
  () => {
    // Both pattern variables are bound; ?x has 2 distinct values, ?y has 4,
    // so ?x (fewer distinct, wider bucket) bounds the estimate.
    const bindings: TermBinding[] = [
      {
        x: namedNode("http://example.org/x1"),
        y: namedNode("http://example.org/y1"),
      },
      {
        x: namedNode("http://example.org/x2"),
        y: namedNode("http://example.org/y2"),
      },
      {
        x: namedNode("http://example.org/x1"),
        y: namedNode("http://example.org/y3"),
      },
      {
        x: namedNode("http://example.org/x2"),
        y: namedNode("http://example.org/y4"),
      },
    ];
    const cost = baseline.estimateJoinCost(
      entry(patternVar, constant, otherVar, candidateQuads(100)),
      bindings,
    );
    assertEquals(cost, 4 * 50);
  },
);

Deno.test(
  "BaselineJoinCostEstimator - fully bound constants never count as variables",
  () => {
    // Every pattern position is a constant: no bound pattern variable to
    // probe, so every binding iterates all candidates.
    const bindings: TermBinding[] = [{ a: namedNode("http://example.org/a") }];
    const cost = baseline.estimateJoinCost(
      entry(constant, constant, constant, candidateQuads(7)),
      bindings,
    );
    assertEquals(cost, 7);
  },
);

Deno.test(
  "WazooSparqlEngine - injected estimator drives reordering without changing results",
  async () => {
    const store = new Store();
    store.addQuad(
      quad(
        namedNode("http://example.org/s1"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/o1"),
      ),
    );
    store.addQuad(
      quad(
        namedNode("http://example.org/s2"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/o2"),
      ),
    );
    const query =
      "SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o . ?s ?p ?o }";

    const calls: number[] = [];
    const estimator: JoinCostEstimator = {
      estimateJoinCost(scan, bindings): number {
        calls.push(bindings.length);
        return scan.candidates.length;
      },
    };
    const engine = new WazooSparqlEngine({ store, estimator });
    const result = await engine.execute({ query });
    assertEquals(result.kind, "select");
    // The greedy loop consults the estimator once per remaining pattern.
    assertEquals(calls.length >= 2, true);

    const expected = await new WazooSparqlEngine({ store }).execute({ query });
    assertEquals(result, expected);
  },
);

Deno.test(
  "WazooSparqlEngine - reorderPatterns:false never consults the estimator",
  async () => {
    const store = new Store();
    store.addQuad(
      quad(
        namedNode("http://example.org/s1"),
        namedNode("http://example.org/p"),
        namedNode("http://example.org/o1"),
      ),
    );
    let calls = 0;
    const estimator: JoinCostEstimator = {
      estimateJoinCost(): number {
        calls += 1;
        return 0;
      },
    };
    const engine = new WazooSparqlEngine({
      store,
      estimator,
      reorderPatterns: false,
    });
    const result = await engine.execute({
      query: "SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o . ?s ?p ?o }",
    });
    assertEquals(result.kind, "select");
    assertEquals(calls, 0);
  },
);

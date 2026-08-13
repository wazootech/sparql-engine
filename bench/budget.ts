import { DataFactory, Store } from "n3";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

const { namedNode, literal, quad } = DataFactory;

const baseline = {
  maxAllowedMs: 50.0,
  tests: [
    {
      name: "BGP 2-pattern join",
      query:
        "SELECT ?s ?name WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name . ?s <http://example.org/p> ?o }",
    },
    {
      name: "Reorder chain join",
      query:
        "SELECT ?s WHERE { ?s <http://example.org/p1> ?o1 . ?o1 <http://example.org/p2> ?o2 }",
    },
  ],
};

async function main() {
  const store = new Store();
  for (let i = 0; i < 100; i++) {
    const s = namedNode(`http://example.org/s${i}`);
    store.addQuad(
      quad(
        s,
        namedNode("http://xmlns.com/foaf/0.1/name"),
        literal(`Name ${i}`),
      ),
    );
    store.addQuad(
      quad(s, namedNode("http://example.org/p"), literal(`Val ${i}`)),
    );
    store.addQuad(
      quad(
        s,
        namedNode("http://example.org/p1"),
        namedNode(`http://example.org/o${i}`),
      ),
    );
    store.addQuad(
      quad(
        namedNode(`http://example.org/o${i}`),
        namedNode("http://example.org/p2"),
        literal(`${i}`),
      ),
    );
  }

  const engine = new WazooSparqlEngine({ store });
  let failed = false;

  console.log("Running performance regression budget checks...");
  for (const testCase of baseline.tests) {
    const start = performance.now();
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
      await engine.execute({ query: testCase.query });
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    console.log(
      `- ${testCase.name}: ${
        avgMs.toFixed(3)
      } ms/iter (budget: <= ${baseline.maxAllowedMs} ms/iter)`,
    );

    if (avgMs > baseline.maxAllowedMs) {
      console.error(
        `  FAIL: ${testCase.name} exceeded performance budget (${
          avgMs.toFixed(3)
        } ms > ${baseline.maxAllowedMs} ms)`,
      );
      failed = true;
    }
  }

  if (failed) {
    console.error("Performance regression budget checks failed.");
    Deno.exit(1);
  } else {
    console.log("All performance budget checks passed.");
  }
}

if (import.meta.main) {
  await main();
}

import { canonicalizeSparqlValue } from "@/term/mod.ts";
import {
  assertQueryParity,
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "./parity-harness.ts";
import type { ParityTestCase } from "./parity-harness.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { aggregateCases, pathCases } from "./parity-cases-path-aggregate.ts";
import {
  askCases,
  constructCases,
  describeCases,
  fromCases,
  graphCases,
  wildcardCases,
} from "./parity-cases-basic.ts";
import { assertEquals, assertMatch } from "@std/assert";
import {
  basicKnowledgeGraphQuads,
  createQuadStore,
} from "./parity-fixtures.ts";
import { exampleAlice } from "./parity-vocab.ts";
import { expressionCases } from "./parity-cases-expression.ts";
import { selectCasesA } from "./parity-cases-select-a.ts";
import { selectCasesB } from "./parity-cases-select-b.ts";

const allCases: ParityTestCase[] = [
  ...selectCasesA,
  ...selectCasesB,
  ...askCases,
  ...constructCases,
  ...describeCases,
  ...wildcardCases,
  ...pathCases,
  ...aggregateCases,
  ...graphCases,
  ...expressionCases,
  ...fromCases,
];

for (const testCase of allCases) {
  Deno.test(`parity - ${testCase.name}`, async () => {
    await assertQueryParity(testCase);
  });
}

Deno.test(
  "parity - known difference: Comunica prefixes blank node labels, Wazoo does not",
  async () => {
    const petQuery =
      `SELECT ?pet WHERE { ${exampleAlice} <http://example.org/pet> ?pet }`;

    const comunicaStore = createQuadStore(basicKnowledgeGraphQuads);
    const comunicaEngine = getComunicaEngine();
    const comunicaBindings = await runComunicaRawSelectBindings(
      comunicaEngine,
      petQuery,
      comunicaStore,
    );

    const wazooStore = createQuadStore(basicKnowledgeGraphQuads);
    const wazooEngine = new WazooSparqlEngine({ store: wazooStore });
    const wazooResult = await wazooEngine.execute({ query: petQuery });
    assertEquals(wazooResult.kind, "select");
    if (wazooResult.kind !== "select") {
      return;
    }

    // Comunica skolemizes blank nodes from query sources into a per-source
    // prefixed label ("bc_<sourceId>_<label>"); the Wazoo engine deliberately
    // returns the store's own label instead.
    assertMatch(comunicaBindings[0].pet.value, /^bc_\d+_pet-ethan$/);
    assertEquals(wazooResult.data.results.bindings[0].pet.value, "pet-ethan");

    // After stripping the cosmetic prefix, both normalize to the same term.
    assertEquals(
      JSON.stringify(canonicalizeComunicaTerm(comunicaBindings[0].pet)),
      JSON.stringify(
        canonicalizeSparqlValue(wazooResult.data.results.bindings[0].pet),
      ),
    );
  },
);

Deno.test(
  "parity - nondeterministic functions agree on shape (BNODE, UUID, STRUUID, RAND, NOW)",
  async () => {
    const comunicaEngine = getComunicaEngine();
    const comunicaStore = createQuadStore([]);
    const wazooEngine = new WazooSparqlEngine({ store: createQuadStore([]) });
    const shapeQueries = {
      bnode: "SELECT ?v WHERE { BIND(BNODE() AS ?v) }",
      bnodeLabel: 'SELECT ?v WHERE { BIND(BNODE("x") AS ?v) }',
      struuid: "SELECT ?v WHERE { BIND(STRUUID() AS ?v) }",
      uuid: "SELECT ?v WHERE { BIND(UUID() AS ?v) }",
      rand: "SELECT ?v WHERE { BIND(RAND() AS ?v) }",
      now: "SELECT ?v WHERE { BIND(NOW() AS ?v) }",
    };
    for (const [name, query] of Object.entries(shapeQueries)) {
      const comunicaBindings = await runComunicaRawSelectBindings(
        comunicaEngine,
        query,
        comunicaStore,
      );
      const comunicaTerm = comunicaBindings[0].v;
      const wazooResult = await wazooEngine.execute({ query });
      assertEquals(wazooResult.kind, "select");
      if (wazooResult.kind !== "select") {
        continue;
      }
      const wazooTerm = wazooResult.data.results.bindings[0].v;
      const comunicaLiteral = comunicaTerm.termType === "Literal"
        ? comunicaTerm
        : null;
      switch (name) {
        case "bnode":
        case "bnodeLabel":
          assertEquals(comunicaTerm.termType, "BlankNode");
          assertEquals(wazooTerm.type, "bnode");
          break;
        case "struuid": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#string",
          );
          assertEquals(wazooTerm.type, "literal");
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
          };
          assertMatch(
            wazooLiteral.value,
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          );
          break;
        }
        case "uuid":
          assertEquals(comunicaTerm.termType, "NamedNode");
          assertMatch(comunicaTerm.value, /^urn:uuid:/);
          assertEquals(wazooTerm.type, "uri");
          assertMatch(
            (wazooTerm as { type: "uri"; value: string }).value,
            /^urn:uuid:/,
          );
          break;
        case "rand": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#double",
          );
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
            datatype?: string;
          };
          assertEquals(wazooLiteral.type, "literal");
          assertEquals(
            wazooLiteral.datatype,
            "http://www.w3.org/2001/XMLSchema#double",
          );
          const wazooValue = Number(wazooLiteral.value);
          if (!(wazooValue >= 0 && wazooValue < 1)) {
            throw new Error(`RAND out of range: ${wazooValue}`);
          }
          break;
        }
        case "now": {
          assertEquals(comunicaTerm.termType, "Literal");
          assertEquals(
            comunicaLiteral?.datatype?.value,
            "http://www.w3.org/2001/XMLSchema#dateTime",
          );
          const wazooLiteral = wazooTerm as {
            type: "literal";
            value: string;
            datatype?: string;
          };
          assertEquals(wazooLiteral.type, "literal");
          assertEquals(
            wazooLiteral.datatype,
            "http://www.w3.org/2001/XMLSchema#dateTime",
          );
          break;
        }
      }
    }
  },
);

Deno.test(
  "parity - known difference: BNODE labels are opaque per engine",
  async () => {
    // Both engines mint a blank node for BNODE("x"), but the labels are
    // engine-specific ("x1" scoped by Comunica, "x" by the wazoo engine).
    // Blank node labels are opaque per SPARQL 1.1, so the parity contract is
    // the term type, not the label.
    const query = `SELECT ?v WHERE { BIND(BNODE("x") AS ?v) }`;
    const comunicaEngine = getComunicaEngine();
    const comunicaBindings = await runComunicaRawSelectBindings(
      comunicaEngine,
      query,
      createQuadStore([]),
    );
    const wazooEngine = new WazooSparqlEngine({
      store: createQuadStore([]),
    });
    const wazooResult = await wazooEngine.execute({ query });
    assertEquals(wazooResult.kind, "select");
    if (wazooResult.kind === "select") {
      assertEquals(comunicaBindings[0].v.termType, "BlankNode");
      assertEquals(wazooResult.data.results.bindings[0].v.type, "bnode");
    }
  },
);

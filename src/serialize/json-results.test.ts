import { assertEquals, assertThrows } from "@std/assert";
import { serializeJsonResults } from "@/serialize/json-results.ts";
import type { SparqlResponse, SparqlValue } from "@/sparql-engine-interface.ts";
import { canonicalizeSparqlValue } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";

/**
 * Issue #61 JSON-only slice pins: serializeJsonResults produces the SPARQL
 * results JSON (.srj) document whose parsed values canonicalize identically
 * to the response's own wire values — including RDF 1.2 direction ("its:dir")
 * and triple terms — with deterministic output and loud rejection of kinds
 * the format does not cover.
 */

/** fullSpread is one binding row exercising every SparqlValue variant the
 * wire format can carry: uri, bnode, plain literal, lang-tagged with base
 * direction, typed literal, and an RDF 1.2 triple term. */
const fullSpread: Record<string, SparqlValue> = {
  iri: { type: "uri", value: "http://example.org/s" },
  bn: { type: "bnode", value: "b0" },
  plain: { type: "literal", value: "hello" },
  lang: { type: "literal", value: "hola", "xml:lang": "es", "its:dir": "rtl" },
  typed: {
    type: "literal",
    value: "42",
    datatype: "http://www.w3.org/2001/XMLSchema#integer",
  },
  triple: {
    type: "triple",
    value: {
      subject: { type: "uri", value: "http://example.org/a" },
      predicate: { type: "uri", value: "http://example.org/p" },
      object: { type: "literal", value: "x", "xml:lang": "en" },
    },
  },
};

const selectResponse: SparqlResponse = {
  kind: "select",
  data: {
    head: { vars: Object.keys(fullSpread) },
    results: { bindings: [fullSpread] },
  },
};

Deno.test(
  "serializeJsonResults - SELECT round-trips every SparqlValue variant",
  () => {
    const parsed = JSON.parse(serializeJsonResults(selectResponse)) as {
      head: { vars: string[] };
      results: { bindings: Array<Record<string, SparqlValue>> };
    };
    assertEquals(parsed.head.vars, Object.keys(fullSpread));
    assertEquals(parsed.results.bindings.length, 1);
    const row = parsed.results.bindings[0];
    for (const name of Object.keys(fullSpread)) {
      assertEquals(
        canonicalizeSparqlValue(row[name]),
        canonicalizeSparqlValue(fullSpread[name]),
        `round-trip ${name}`,
      );
    }
  },
);

Deno.test("serializeJsonResults - ASK round-trips the boolean", () => {
  for (const boolean of [true, false]) {
    const parsed = JSON.parse(
      serializeJsonResults({ kind: "ask", data: { head: {}, boolean } }),
    ) as { head: unknown; boolean: boolean };
    assertEquals(parsed.boolean, boolean);
    assertEquals(parsed.head, {});
  }
});

Deno.test("serializeJsonResults - emits a deterministic .srj document", () => {
  const response: SparqlResponse = {
    kind: "select",
    data: {
      head: { vars: ["iri", "lang"] },
      results: {
        bindings: [
          {
            iri: { type: "uri", value: "http://example.org/s" },
            lang: {
              type: "literal",
              value: "hola",
              "xml:lang": "es",
              "its:dir": "rtl",
            },
          },
        ],
      },
    },
  };
  const golden = '{"head":{"vars":["iri","lang"]},"results":{"bindings":[' +
    '{"iri":{"type":"uri","value":"http://example.org/s"},' +
    '"lang":{"type":"literal","value":"hola","xml:lang":"es","its:dir":"rtl"}}]}}';
  assertEquals(serializeJsonResults(response), golden);
  // Determinism: serializing the same response twice is byte-identical.
  assertEquals(serializeJsonResults(response), serializeJsonResults(response));
});

Deno.test("serializeJsonResults - passes head link through", () => {
  const parsed = JSON.parse(
    serializeJsonResults({
      kind: "ask",
      data: { head: { link: ["http://example.org/result"] }, boolean: true },
    }),
  ) as { head: { link?: string[] }; boolean: boolean };
  assertEquals(parsed.head.link, ["http://example.org/result"]);
  assertEquals(parsed.boolean, true);
});

Deno.test(
  "serializeJsonResults - rejects kinds the format does not cover",
  () => {
    assertThrows(
      () =>
        serializeJsonResults({
          kind: "construct",
          data: { quads: [] },
        }),
      Error,
      "SELECT and ASK",
    );
    assertThrows(
      () => serializeJsonResults({ kind: "void" }),
      Error,
      "SELECT and ASK",
    );
  },
);

Deno.test(
  "serializeJsonResults - JSON-escapes special characters in values",
  () => {
    const parsed = JSON.parse(
      serializeJsonResults({
        kind: "select",
        data: {
          head: { vars: ["v"] },
          results: {
            bindings: [{
              v: { type: "literal", value: 'a"b\\c\n\u0001d' },
            }],
          },
        },
      }),
    ) as { results: { bindings: Array<Record<string, SparqlValue>> } };
    // JSON.stringify escapes quotes, backslashes, and control characters;
    // the parsed value is byte-identical to the original literal text.
    assertEquals(parsed.results.bindings[0].v, {
      type: "literal",
      value: 'a"b\\c\n\u0001d',
    });
  },
);

Deno.test(
  "serializeJsonResults - round-trips a directional literal end to end",
  async () => {
    // A real query through the engine: the RDF 1.2 directional literal
    // ("its:dir") must survive execute() -> SparqlValue -> .srj -> parse.
    const store = new Store();
    const engine = new WazooSparqlEngine({ store });
    const result = await engine.execute({
      query: 'SELECT ?v WHERE { BIND("hola"@es--rtl AS ?v) }',
    });
    if (result.kind !== "select") {
      throw new Error(`expected select, got ${result.kind}`);
    }
    const doc = JSON.parse(serializeJsonResults(result)) as {
      results: { bindings: Array<Record<string, SparqlValue>> };
    };
    const emitted = doc.results.bindings[0].v;
    assertEquals(emitted, {
      type: "literal",
      value: "hola",
      "xml:lang": "es",
      "its:dir": "rtl",
    });
  },
);

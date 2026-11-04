import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { serializeXmlResults } from "@/serialize/xml-results.ts";

Deno.test("serializeXmlResults - emits a deterministic .srx document", () => {
  const response: SparqlResponse = {
    kind: "select",
    data: {
      head: { vars: ["iri", "bn", "lang"] },
      results: {
        bindings: [
          {
            iri: { type: "uri", value: "http://example.org/s" },
            bn: { type: "bnode", value: "b0" },
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
  const golden = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sparql xmlns="http://www.w3.org/2005/sparql-results#" ' +
    'xmlns:its="http://www.w3.org/2005/11/its" its:version="2.0">\n' +
    "  <head>\n" +
    '    <variable name="iri"/>\n' +
    '    <variable name="bn"/>\n' +
    '    <variable name="lang"/>\n' +
    "  </head>\n" +
    "  <results>\n" +
    "    <result>\n" +
    '      <binding name="iri">\n' +
    "        <uri>http://example.org/s</uri>\n" +
    "      </binding>\n" +
    '      <binding name="bn">\n' +
    "        <bnode>b0</bnode>\n" +
    "      </binding>\n" +
    '      <binding name="lang">\n' +
    '        <literal xml:lang="es" its:dir="rtl">hola</literal>\n' +
    "      </binding>\n" +
    "    </result>\n" +
    "  </results>\n" +
    "</sparql>\n";
  assertEquals(serializeXmlResults(response), golden);
  assertEquals(
    serializeXmlResults(response),
    serializeXmlResults(response),
  );
});

Deno.test(
  "serializeXmlResults - rejects kinds the format does not cover",
  () => {
    assertThrows(
      () =>
        serializeXmlResults({
          kind: "construct",
          data: { quads: [] },
        }),
      Error,
      "SELECT and ASK",
    );
    assertThrows(
      () => serializeXmlResults({ kind: "void" }),
      Error,
      "SELECT and ASK",
    );
  },
);

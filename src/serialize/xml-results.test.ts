import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { assertEquals } from "@std/assert";
import {
  bindingRowsOf,
  fullSpread,
  parseXml,
  selectResponse,
  xmlTermToSparqlValue,
} from "@/serialize/xml-results-test-helpers.ts";
import { canonicalizeSparqlValue } from "@/term/mod.ts";
import { serializeXmlResults } from "@/serialize/xml-results.ts";

Deno.test(
  "serializeXmlResults - SELECT round-trips every SparqlValue variant",
  () => {
    const root = parseXml(serializeXmlResults(selectResponse));
    const rows = bindingRowsOf(root);
    assertEquals(rows.length, 1);
    for (const name of Object.keys(fullSpread)) {
      assertEquals(
        canonicalizeSparqlValue(xmlTermToSparqlValue(rows[0][name])),
        canonicalizeSparqlValue(fullSpread[name]),
        `round-trip ${name}`,
      );
    }
  },
);

Deno.test(
  "serializeXmlResults - triple-term nesting matches the sparql12 fixture shape",
  () => {
    const root = parseXml(serializeXmlResults(selectResponse));
    const triple = bindingRowsOf(root)[0].triple;
    assertEquals(triple.name, "triple");
    assertEquals(
      triple.children.map((child) => child.name),
      ["subject", "predicate", "object"],
    );
    // subject/predicate/object each wrap exactly one term element.
    for (const role of triple.children) {
      assertEquals(role.children.length, 1);
    }
    assertEquals(
      xmlTermToSparqlValue(triple.children[0].children[0]),
      { type: "uri", value: "http://example.org/a" },
    );
  },
);

Deno.test("serializeXmlResults - XML-escapes text and attribute values", () => {
  const response: SparqlResponse = {
    kind: "select",
    data: {
      head: {
        vars: ["v"],
        link: ["http://example.org/?a=1&b=2"],
      },
      results: {
        bindings: [{ v: { type: "literal", value: "a<b&c>d\"e'f" } }],
      },
    },
  };
  const doc = serializeXmlResults(response);
  const root = parseXml(doc);
  const link = root.children[0].children.find((c) => c.name === "link");
  assertEquals(link?.attrs.href, "http://example.org/?a=1&b=2");
  assertEquals(
    bindingRowsOf(root)[0].v.text,
    "a<b&c>d\"e'f",
  );
  // The raw document carries the escaped forms.
  assertEquals(doc.includes("&amp;b=2"), true);
  assertEquals(doc.includes("a&lt;b&amp;c&gt;d"), true);
});

Deno.test("serializeXmlResults - blank-node labels round-trip intact", () => {
  const root = parseXml(serializeXmlResults(selectResponse));
  const bn = bindingRowsOf(root)[0].bn;
  assertEquals(bn.name, "bnode");
  assertEquals(bn.text, "b0");
  assertEquals(xmlTermToSparqlValue(bn), { type: "bnode", value: "b0" });
});

Deno.test("serializeXmlResults - ASK round-trips the boolean", () => {
  for (const boolean of [true, false]) {
    const root = parseXml(
      serializeXmlResults({ kind: "ask", data: { head: {}, boolean } }),
    );
    const booleanNode = root.children.find((c) => c.name === "boolean");
    assertEquals(booleanNode?.text, String(boolean));
  }
});

import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindingRowsOf,
  fullSpread,
  parseXml,
  selectResponse,
  xmlTermToSparqlValue,
} from "@/serialize/xml-results-test-helpers.ts";
import { canonicalizeSparqlValue } from "@/term/mod.ts";
import { serializeXmlResults } from "@/serialize/xml-results.ts";

test("serializeXmlResults - SELECT round-trips every SparqlValue variant", () => {
  const root = parseXml(serializeXmlResults(selectResponse));
  const rows = bindingRowsOf(root);
  assert.deepStrictEqual(rows.length, 1);
  for (const name of Object.keys(fullSpread)) {
    assert.deepStrictEqual(
      canonicalizeSparqlValue(xmlTermToSparqlValue(rows[0][name])),
      canonicalizeSparqlValue(fullSpread[name]),
      `round-trip ${name}`,
    );
  }
});

test("serializeXmlResults - triple-term nesting matches the sparql12 fixture shape", () => {
  const root = parseXml(serializeXmlResults(selectResponse));
  const triple = bindingRowsOf(root)[0].triple;
  assert.deepStrictEqual(triple.name, "triple");
  assert.deepStrictEqual(
    triple.children.map((child) => child.name),
    ["subject", "predicate", "object"],
  );
  // subject/predicate/object each wrap exactly one term element.
  for (const role of triple.children) {
    assert.deepStrictEqual(role.children.length, 1);
  }
  assert.deepStrictEqual(xmlTermToSparqlValue(triple.children[0].children[0]), {
    type: "uri",
    value: "http://example.org/a",
  });
});

test("serializeXmlResults - XML-escapes text and attribute values", () => {
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
  assert.deepStrictEqual(link?.attrs.href, "http://example.org/?a=1&b=2");
  assert.deepStrictEqual(bindingRowsOf(root)[0].v.text, "a<b&c>d\"e'f");
  // The raw document carries the escaped forms.
  assert.deepStrictEqual(doc.includes("&amp;b=2"), true);
  assert.deepStrictEqual(doc.includes("a&lt;b&amp;c&gt;d"), true);
});

test("serializeXmlResults - blank-node labels round-trip intact", () => {
  const root = parseXml(serializeXmlResults(selectResponse));
  const bn = bindingRowsOf(root)[0].bn;
  assert.deepStrictEqual(bn.name, "bnode");
  assert.deepStrictEqual(bn.text, "b0");
  assert.deepStrictEqual(xmlTermToSparqlValue(bn), {
    type: "bnode",
    value: "b0",
  });
});

test("serializeXmlResults - ASK round-trips the boolean", () => {
  for (const boolean of [true, false]) {
    const root = parseXml(
      serializeXmlResults({ kind: "ask", data: { head: {}, boolean } }),
    );
    const booleanNode = root.children.find((c) => c.name === "boolean");
    assert.deepStrictEqual(booleanNode?.text, String(boolean));
  }
});

test("serializeXmlResults - head links appear only when present", () => {
  const link = ["http://example.org/meta"];
  const element = `<link href="${link[0]}"/>`;
  const select = serializeXmlResults({
    kind: "select",
    data: { head: { vars: ["a"], link }, results: { bindings: [] } },
  });
  assert.ok(select.includes(element));
  const linked = serializeXmlResults({
    kind: "ask",
    data: { head: { link }, boolean: true },
  });
  assert.ok(linked.includes(element));
  const unlinked = serializeXmlResults({
    kind: "ask",
    data: { head: {}, boolean: true },
  });
  assert.ok(!unlinked.includes("<link"));
});

test("serializeXmlResults - quotes are escaped in attributes", () => {
  const document = serializeXmlResults({
    kind: "select",
    data: { head: { vars: [`a"'`] }, results: { bindings: [] } },
  });
  assert.ok(document.includes('name="a&quot;&apos;"'));
});

import { assertEquals, assertThrows } from "@std/assert";
import { serializeXmlResults } from "@/serialize/xml-results.ts";
import type { SparqlResponse, SparqlValue } from "@/sparql-engine-interface.ts";
import { canonicalizeSparqlValue } from "@/term/mod.ts";

/**
 * Issue #61 XML half pins: serializeXmlResults produces the SPARQL results
 * XML (.srx) document whose parsed content canonicalizes identically to the
 * response's wire values — including RDF 1.2 direction (its:dir), triple-term
 * nesting, and blank-node labels — with XML escaping and deterministic
 * output, and loud rejection of kinds the format does not cover.
 */

/* ------------------------------------------------------------------ */
/* Minimal XML reader (test-only): parses the writer's controlled       */
/* element subset — attrs, text, five entities, no CDATA/namespaces.    */
/* ------------------------------------------------------------------ */

interface XNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XNode[];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseXml(doc: string): XNode {
  let pos = 0;
  const isNameChar = (ch: string): boolean => /[A-Za-z0-9_:.-]/.test(ch);

  const skipWs = (): void => {
    while (pos < doc.length && /\s/.test(doc[pos])) pos++;
  };
  const expect = (text: string): void => {
    if (!doc.startsWith(text, pos)) {
      throw new Error(`expected ${text} at ${pos}`);
    }
    pos += text.length;
  };
  const parseName = (): string => {
    const start = pos;
    while (pos < doc.length && isNameChar(doc[pos])) pos++;
    return doc.slice(start, pos);
  };
  const parseAttributes = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (doc[pos] === ">" || (doc[pos] === "/" && doc[pos + 1] === ">")) {
        return attrs;
      }
      const name = parseName();
      skipWs();
      expect("=");
      skipWs();
      const quote = doc[pos];
      pos++;
      const start = pos;
      while (doc[pos] !== quote) pos++;
      attrs[name] = decodeEntities(doc.slice(start, pos));
      pos++;
    }
  };
  const parseElement = (): XNode => {
    skipWs();
    expect("<");
    const name = parseName();
    const attrs = parseAttributes();
    if (doc[pos] === "/" && doc[pos + 1] === ">") {
      pos += 2;
      return { name, attrs, text: "", children: [] };
    }
    expect(">");
    const node: XNode = { name, attrs, text: "", children: [] };
    for (;;) {
      const lt = doc.indexOf("<", pos);
      const text = doc.slice(pos, lt);
      if (text.trim() !== "") {
        node.text = decodeEntities(text);
      }
      pos = lt;
      if (doc.startsWith("</", pos)) {
        pos += 2;
        const closeName = parseName();
        if (closeName !== name) {
          throw new Error(`mismatched close tag ${closeName} for ${name}`);
        }
        while (doc[pos] !== ">") pos++;
        pos++;
        return node;
      }
      if (doc.startsWith("<?", pos)) {
        pos = doc.indexOf("?>", pos) + 2;
        continue;
      }
      node.children.push(parseElement());
    }
  };

  skipWs();
  if (doc.startsWith("<?", pos)) {
    pos = doc.indexOf("?>", pos) + 2;
  }
  return parseElement();
}

/** xmlTermToSparqlValue converts one parsed term element back to a wire
 * value, so the round trip compares canonicalized SparqlValues symmetrically
 * with the JSON writer tests. */
function xmlTermToSparqlValue(node: XNode): SparqlValue {
  switch (node.name) {
    case "uri":
      return { type: "uri", value: node.text };
    case "bnode":
      return { type: "bnode", value: node.text };
    case "literal": {
      const value: SparqlValue = { type: "literal", value: node.text };
      if (node.attrs["xml:lang"]) {
        value["xml:lang"] = node.attrs["xml:lang"];
        if (node.attrs["its:dir"]) {
          value["its:dir"] = node.attrs["its:dir"] as "ltr" | "rtl";
        }
      } else if (node.attrs.datatype) {
        value.datatype = node.attrs.datatype;
      }
      return value;
    }
    case "triple": {
      const part = (role: string): SparqlValue => {
        const wrapper = node.children.find((child) => child.name === role);
        if (wrapper === undefined || wrapper.children.length !== 1) {
          throw new Error(`missing ${role} in triple term`);
        }
        return xmlTermToSparqlValue(wrapper.children[0]);
      };
      return {
        type: "triple",
        value: {
          subject: part("subject"),
          predicate: part("predicate"),
          object: part("object"),
        },
      };
    }
    default:
      throw new Error(`unexpected term element ${node.name}`);
  }
}

/** bindingRowsOf extracts {name -> term node} rows from a parsed document. */
function bindingRowsOf(root: XNode): Array<Record<string, XNode>> {
  const results = root.children.find((child) => child.name === "results");
  if (results === undefined) return [];
  return results.children.map((result) => {
    const row: Record<string, XNode> = {};
    for (const binding of result.children) {
      row[binding.attrs.name] = binding.children[0];
    }
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Fixtures and tests.                                                 */
/* ------------------------------------------------------------------ */

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

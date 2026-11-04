import type { SparqlResponse, SparqlValue } from "@/sparql-engine-interface.ts";

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

export function parseXml(doc: string): XNode {
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
export function xmlTermToSparqlValue(node: XNode): SparqlValue {
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
export function bindingRowsOf(root: XNode): Array<Record<string, XNode>> {
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

export const fullSpread: Record<string, SparqlValue> = {
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

export const selectResponse: SparqlResponse = {
  kind: "select",
  data: {
    head: { vars: Object.keys(fullSpread) },
    results: { bindings: [fullSpread] },
  },
};

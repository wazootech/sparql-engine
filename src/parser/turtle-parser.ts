import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";

/**
 * parseTurtleQuads is a lightweight, zero-dependency Turtle / N-Triples parser
 * supporting PREFIX, BASE, predicate/object lists, IRIs, literals, blank nodes,
 * and numbers/booleans for SPARQL LOAD operations.
 */
export function parseTurtleQuads(
  text: string,
  baseIri: string = "",
): rdfjs.Quad[] {
  const prefixes = new Map<string, string>();
  let currentBase = baseIri;
  const quads: rdfjs.Quad[] = [];
  let bnodeCounter = 0;

  function resolveIri(iri: string): string {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(iri)) {
      return iri;
    }
    if (!currentBase) {
      return iri;
    }
    try {
      return new URL(iri, currentBase).href;
    } catch {
      return currentBase + iri;
    }
  }

  // Tokenizer regex
  const tokenRegex =
    /\s*(@prefix|@base|PREFIX|BASE|a|true|false|<[^>]*>|_:[A-Za-z0-9_-]+|"[^"\\]*(?:\\.[^"\\]*)*"(?:@[a-zA-Z-]+|\^\^<[^>]*>|\^\^[A-Za-z0-9_:-]+)?|[A-Za-z0-9_:-]*:[A-Za-z0-9_:-]*|[-+]?[0-9]+(?:\.[0-9]+)?|\.|;|,|\[|\]|\(|\)|#.*)/g;

  let match: RegExpExecArray | null;
  const tokens: string[] = [];

  // Simple scanner line by line to strip full line comments or tokenizing
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) {
      continue;
    }
    tokenRegex.lastIndex = 0;
    while ((match = tokenRegex.exec(line)) !== null) {
      const tok = match[1];
      if (tok && !tok.startsWith("#")) {
        tokens.push(tok);
      }
    }
  }

  let idx = 0;
  function peek(): string | undefined {
    return tokens[idx];
  }
  function next(): string {
    return tokens[idx++];
  }

  function parseTerm(): rdfjs.Term {
    const tok = next();
    if (!tok) {
      throw new Error("Unexpected end of Turtle input");
    }
    if (tok === "a") {
      return DataFactory.namedNode(
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      );
    }
    if (tok === "true" || tok === "false") {
      return DataFactory.literal(
        tok,
        DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#boolean"),
      );
    }
    if (/^[-+]?[0-9]+$/.test(tok)) {
      return DataFactory.literal(
        tok,
        DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#integer"),
      );
    }
    if (/^[-+]?[0-9]+\.[0-9]+$/.test(tok)) {
      return DataFactory.literal(
        tok,
        DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#decimal"),
      );
    }
    if (tok.startsWith("<") && tok.endsWith(">")) {
      const raw = tok.slice(1, -1);
      return DataFactory.namedNode(resolveIri(raw));
    }
    if (tok.startsWith("_:")) {
      return DataFactory.blankNode(tok.slice(2));
    }
    if (tok === "[") {
      const bnode = DataFactory.blankNode(`b_${++bnodeCounter}`);
      if (peek() === "]") {
        next();
        return bnode;
      }
      parsePredicateObjectList(bnode);
      if (peek() === "]") {
        next();
      }
      return bnode;
    }
    if (tok.startsWith('"')) {
      const lastQuote = tok.lastIndexOf('"');
      const val = tok.slice(1, lastQuote).replace(/\\"/g, '"').replace(
        /\\\\/g,
        "\\",
      );
      const rest = tok.slice(lastQuote + 1);
      if (rest.startsWith("@")) {
        return DataFactory.literal(val, rest.slice(1));
      }
      if (rest.startsWith("^^<") && rest.endsWith(">")) {
        return DataFactory.literal(
          val,
          DataFactory.namedNode(resolveIri(rest.slice(3, -1))),
        );
      }
      if (rest.startsWith("^^")) {
        const dtIri = parsePrefixedIri(rest.slice(2));
        return DataFactory.literal(val, DataFactory.namedNode(dtIri));
      }
      return DataFactory.literal(val);
    }
    if (tok.includes(":")) {
      return DataFactory.namedNode(parsePrefixedIri(tok));
    }
    throw new Error(`Invalid Turtle term token: ${tok}`);
  }

  function parsePrefixedIri(tok: string): string {
    const colonIdx = tok.indexOf(":");
    const pfx = tok.slice(0, colonIdx);
    const local = tok.slice(colonIdx + 1);
    const ns = prefixes.get(pfx);
    if (ns == null) {
      return tok;
    }
    return ns + local;
  }

  function parsePredicateObjectList(subj: rdfjs.Term): void {
    while (idx < tokens.length) {
      const tok = peek();
      if (!tok || tok === "." || tok === "]") {
        break;
      }
      const pred = parseTerm();
      while (idx < tokens.length) {
        const obj = parseTerm();
        quads.push(
          DataFactory.quad(subj, pred, obj, DataFactory.defaultGraph()),
        );

        if (peek() === ",") {
          next();
          continue;
        }
        break;
      }
      if (peek() === ";") {
        next();
        continue;
      }
      break;
    }
  }

  while (idx < tokens.length) {
    const tok = peek();
    if (!tok) {
      break;
    }
    if (tok === "@prefix" || tok === "PREFIX") {
      next();
      let pfx = next();
      if (pfx.endsWith(":")) {
        pfx = pfx.slice(0, -1);
      }
      const iriTok = next();
      const raw = iriTok.startsWith("<") ? iriTok.slice(1, -1) : iriTok;
      prefixes.set(pfx, resolveIri(raw));
      if (peek() === ".") {
        next();
      }
      continue;
    }
    if (tok === "@base" || tok === "BASE") {
      next();
      const iriTok = next();
      const raw = iriTok.startsWith("<") ? iriTok.slice(1, -1) : iriTok;
      currentBase = resolveIri(raw);
      if (peek() === ".") {
        next();
      }
      continue;
    }

    const subj = parseTerm();
    parsePredicateObjectList(subj);
    if (peek() === ".") {
      next();
    }
  }

  return quads;
}

import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const RDF_REIFIES = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";
const XSD_DOUBLE = "http://www.w3.org/2001/XMLSchema#double";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

const { blankNode, defaultGraph, literal, namedNode, quad } = DataFactory;

type Token =
  | { type: "iri"; value: string }
  | { type: "pname"; prefix: string; local: string }
  | { type: "bnode"; label: string }
  | { type: "literal"; value: string; lang?: string; datatype?: string }
  | { type: "number"; value: string; kind: "integer" | "decimal" | "double" }
  | { type: "word"; value: string }
  | { type: "keyword"; value: "PREFIX" | "BASE" | "GRAPH" }
  | { type: "punct"; value: string }
  | { type: "eof" };

const STRUCTURAL = new Set([";", ",", ".", "[", "]", "(", ")", "{", "}"]);

/**
 * Characters that terminate a prefixed-name local part. The '.' is NOT a
 * boundary: locals like `:a.b` are legal, and the trailing-dot rule for the
 * triple terminator is applied as a backtrack in scanPnameRest.
 */
const TERM_BOUNDARY = new Set([
  " ",
  "\t",
  "\r",
  "\n",
  ";",
  ",",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  '"',
  "'",
  "@",
  "^",
]);

/**
 * TurtleTriGParser is a zero-dependency recursive-descent parser for Turtle,
 * TriG, N-Triples/N-Quads (subset), and RDF 1.2 triple terms (<< >>) covering
 * the W3C SPARQL test-suite fixture files plus SPARQL LOAD inputs. It expands
 * collections into rdf:first/rdf:rest/rdf:nil chains, resolves prefixed names
 * and relative IRIs against the document base, decodes literal escapes, tags
 * numeric literals with their XML Schema datatypes, and expands RDF 1.2
 * reifier annotations (<< s p o ~ r >>) and annotated triples ({| ... |})
 * into rdf:reifies quads. Following N3.js, a bare `<< s p o >>` occurrence in
 * the subject or object position of an asserted triple is a reified
 * occurrence: a fresh blank node (or the `~`-named reifier) takes its place
 * and an `rdf:reifies` quad is emitted, while `<<( ... )>>` terms are always
 * used as-is.
 */
class TurtleTriGParser {
  private pos = 0;
  private readonly prefixes = new Map<string, string>();
  private base: string;
  private graph: rdfjs.Term = defaultGraph();
  private bnodeCounter = 0;
  private readonly quads: rdfjs.Quad[] = [];
  /** Last (subject, predicate, object) triple emitted, for {| |} annotations. */
  private lastTriple: {
    subject: rdfjs.Term;
    predicate: rdfjs.Term;
    object: rdfjs.Term;
  } | null = null;
  /** Bare-form `<< s p o >>` triple terms; only these get reified occurrences. */
  private readonly bareTripleTerms = new WeakSet<object>();
  /** Explicit `~ reifier` terms attached to parsed triple terms. */
  private readonly tripleTermReifiers = new Map<object, rdfjs.Term>();

  public constructor(
    private readonly text: string,
    baseIri: string = "",
  ) {
    this.base = baseIri;
  }

  public parse(): rdfjs.Quad[] {
    while (true) {
      this.skipWsAndComments();
      const tok = this.peek();
      if (tok.type === "eof") {
        break;
      }
      if (tok.type === "keyword" && tok.value === "PREFIX") {
        this.next();
        this.parsePrefixDirective();
        continue;
      }
      if (tok.type === "keyword" && tok.value === "BASE") {
        this.next();
        this.parseBaseDirective();
        continue;
      }
      if (tok.type === "keyword" && tok.value === "GRAPH") {
        this.next();
        this.parseGraphBlock(this.parseGraphLabel());
        continue;
      }
      this.parseTriplesOrGraph();
    }
    return this.quads;
  }

  // -------------------------------------------------------------------------
  // Directives
  // -------------------------------------------------------------------------

  private parsePrefixDirective(): void {
    const pname = this.expectPname();
    const iri = this.expectIri();
    this.prefixes.set(pname.prefix, iri);
    this.consumeOptionalDot();
  }

  private parseBaseDirective(): void {
    this.base = this.expectIri();
    this.consumeOptionalDot();
  }

  // -------------------------------------------------------------------------
  // Triples and graphs
  // -------------------------------------------------------------------------

  private parseTriplesOrGraph(): void {
    const subject = this.parseTerm();
    const following = this.peek();
    if (following.type === "punct" && following.value === "{") {
      // TriG: a bare label followed by a block opens a named graph.
      this.next();
      this.parseGraphBody(subject);
      return;
    }
    this.parsePredicateObjectList(this.reifyOccurrence(subject, this.graph));
    this.parseAnnotationIfPresent();
    this.expect(".");
  }

  private parseGraphLabel(): rdfjs.Term {
    const tok = this.next();
    let label: rdfjs.Term;
    if (tok.type === "iri") {
      label = namedNode(this.resolveIri(tok.value));
    } else if (tok.type === "pname") {
      label = namedNode(this.expandPname(tok.prefix, tok.local));
    } else if (tok.type === "bnode") {
      label = blankNode(tok.label);
    } else {
      throw this.error("expected a graph label");
    }
    return label;
  }

  private parseGraphBlock(label: rdfjs.Term): void {
    this.expect("{");
    this.parseGraphBody(label);
  }

  private parseGraphBody(label: rdfjs.Term): void {
    const outerGraph = this.graph;
    this.graph = label;
    while (true) {
      this.skipWsAndComments();
      const tok = this.peek();
      if (tok.type === "eof") {
        break;
      }
      if (tok.type === "punct" && tok.value === "}") {
        this.next();
        break;
      }
      this.parseTriples();
    }
    this.graph = outerGraph;
  }

  private parseTriples(): void {
    const subject = this.reifyOccurrence(this.parseTerm(), this.graph);
    this.parsePredicateObjectList(subject);
    this.parseAnnotationIfPresent();
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === ".") {
      this.next();
      return;
    }
    // The final triple inside a TriG graph block may omit the '.'.
    if (tok.type === "punct" && tok.value === "}") {
      return;
    }
    throw this.error("expected '.'");
  }

  private parsePredicateObjectList(subject: rdfjs.Term): void {
    while (true) {
      const predicate = this.parseVerb();
      this.parseObjectList(subject, predicate);
      const tok = this.peek();
      if (tok.type === "punct" && tok.value === ";") {
        this.next();
        // A trailing ';' before the terminator or a closing bracket is legal.
        const after = this.peek();
        if (
          after.type === "punct" &&
          (after.value === "." || after.value === "]" || after.value === "}")
        ) {
          break;
        }
        continue;
      }
      break;
    }
  }

  private parseVerb(): rdfjs.Term {
    const tok = this.peek();
    if (tok.type === "word" && tok.value === "a") {
      this.next();
      return namedNode(RDF_TYPE);
    }
    const term = this.parseTerm();
    if (term.termType !== "NamedNode") {
      throw this.error("predicate must be an IRI");
    }
    return term;
  }

  private parseObjectList(subject: rdfjs.Term, predicate: rdfjs.Term): void {
    while (true) {
      const object = this.reifyOccurrence(this.parseTerm(), this.graph);
      this.quads.push(quad(subject, predicate, object, this.graph));
      this.lastTriple = { subject, predicate, object };
      const tok = this.peek();
      if (tok.type === "punct" && tok.value === ",") {
        this.next();
        continue;
      }
      break;
    }
  }

  /**
   * parseAnnotationIfPresent handles the RDF 1.2 annotated-triple syntax
   * `s p o {| p1 o1 |}`: it reifies the last emitted triple with a fresh
   * blank node and attaches the annotation predicate-object pairs to that
   * reifier, exactly like the equivalent `<< s p o ~ _:b >> p1 o1` form.
   */
  private parseAnnotationIfPresent(): void {
    const tok = this.peek();
    if (!(tok.type === "punct" && tok.value === "{|")) {
      return;
    }
    if (!this.lastTriple) {
      throw this.error("annotation without a triple");
    }
    const triple = this.lastTriple;
    this.next(); // consume {|
    const tripleTerm = quad(triple.subject, triple.predicate, triple.object);
    const reifier = blankNode(`b${++this.bnodeCounter}`);
    this.quads.push(
      quad(reifier, namedNode(RDF_REIFIES), tripleTerm, this.graph),
    );
    while (true) {
      const predicate = this.parseVerb();
      this.parseObjectList(reifier, predicate);
      const after = this.peek();
      if (after.type === "punct" && after.value === ";") {
        this.next();
        const nextTok = this.peek();
        if (nextTok.type === "punct" && nextTok.value === "|}") {
          break;
        }
        continue;
      }
      break;
    }
    this.expect("|}");
  }

  // -------------------------------------------------------------------------
  // Terms
  // -------------------------------------------------------------------------

  private parseTerm(): rdfjs.Term {
    const tok = this.peek();
    switch (tok.type) {
      case "iri":
        this.next();
        return namedNode(this.resolveIri(tok.value));
      case "pname":
        this.next();
        return namedNode(this.expandPname(tok.prefix, tok.local));
      case "bnode":
        this.next();
        return blankNode(tok.label);
      case "literal":
        this.next();
        return tok.lang !== undefined
          ? literal(tok.value, tok.lang)
          : tok.datatype !== undefined
          ? literal(tok.value, namedNode(tok.datatype))
          : literal(tok.value);
      case "number":
        this.next();
        return this.numericLiteral(tok);
      case "word":
        if (tok.value === "true" || tok.value === "false") {
          this.next();
          return literal(tok.value, namedNode(XSD_BOOLEAN));
        }
        throw this.error(`unexpected bare word '${tok.value}'`);
      case "punct":
        if (tok.value === "[") {
          return this.parseBlankNodePropertyList();
        }
        if (tok.value === "(") {
          return this.parseCollection();
        }
        if (tok.value === "<<") {
          return this.parseTripleTerm();
        }
        throw this.error(`unexpected token '${tok.value}'`);
      default:
        throw this.error(`unexpected token '${this.describe(tok)}'`);
    }
  }

  private numericLiteral(
    tok: Extract<Token, { type: "number" }>,
  ): rdfjs.Literal {
    const datatype = tok.kind === "integer"
      ? XSD_INTEGER
      : tok.kind === "decimal"
      ? XSD_DECIMAL
      : XSD_DOUBLE;
    return literal(tok.value, namedNode(datatype));
  }

  private parseBlankNodePropertyList(): rdfjs.Term {
    this.expect("[");
    const node = blankNode(`b${++this.bnodeCounter}`);
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === "]") {
      this.next();
      return node;
    }
    this.parsePredicateObjectList(node);
    this.expect("]");
    return node;
  }

  private parseCollection(): rdfjs.Term {
    this.expect("(");
    const items: rdfjs.Term[] = [];
    while (true) {
      const tok = this.peek();
      if (tok.type === "punct" && tok.value === ")") {
        this.next();
        break;
      }
      if (tok.type === "eof") {
        throw this.error("unterminated collection");
      }
      items.push(this.parseTerm());
    }
    return this.expandCollection(items);
  }

  private expandCollection(items: rdfjs.Term[]): rdfjs.Term {
    if (items.length === 0) {
      return namedNode(RDF_NIL);
    }
    const head = blankNode(`b${++this.bnodeCounter}`);
    let current: rdfjs.Term = head;
    for (let i = 0; i < items.length; i++) {
      const rest = i === items.length - 1
        ? namedNode(RDF_NIL)
        : blankNode(`b${++this.bnodeCounter}`);
      this.quads.push(
        quad(
          current,
          namedNode(RDF_FIRST),
          this.reifyOccurrence(items[i], this.graph),
          this.graph,
        ),
      );
      this.quads.push(
        quad(current, namedNode(RDF_REST), rest, this.graph),
      );
      current = rest;
    }
    return head;
  }

  private parseTripleTerm(): rdfjs.Term {
    this.expect("<<");
    // The optional parentheses in `<<( s p o )>>` wrap the whole triple; they
    // are not a collection, so check for them before parsing the subject.
    const first = this.peek();
    const parenthesized = first.type === "punct" && first.value === "(";
    if (parenthesized) {
      this.next();
    }
    const subject = this.parseTerm();
    const predicate = this.parseTerm();
    if (predicate.termType !== "NamedNode") {
      throw this.error("triple-term predicate must be an IRI");
    }
    const object = this.parseTerm();
    if (parenthesized) {
      this.expect(")");
    }
    const tripleTerm = quad(subject, predicate, object);
    // Bare `<< s p o >>` terms get reified occurrences when placed in subject
    // or object position (see reifyOccurrence); `<<( ... )>>` terms never do.
    if (!parenthesized) {
      this.bareTripleTerms.add(tripleTerm);
    }
    // RDF 1.2 reifier annotation: `<< s p o ~ r >>` names the reifier that
    // replaces the occurrence; the `r rdf:reifies <<term>>` quad is emitted by
    // reifyOccurrence when the occurrence is placed.
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === "~") {
      this.next();
      const reifier = this.parseTerm();
      this.tripleTermReifiers.set(tripleTerm, reifier);
    }
    this.expect(">>");
    return tripleTerm;
  }

  /**
   * reifyOccurrence applies RDF 1.2 reification to a bare `<< s p o >>`
   * triple-term occurrence in the subject or object position of an asserted
   * triple (matching N3.js): a fresh blank node — or the `~`-named reifier —
   * takes the occurrence's place and an `rdf:reifies` quad is emitted,
   * recursively reifying bare triple terms nested in the inner subject/object
   * positions. Parenthesized `<<( ... )>>` terms are never reified and pass
   * through unchanged.
   */
  private reifyOccurrence(term: rdfjs.Term, graph: rdfjs.Term): rdfjs.Term {
    if (term.termType !== "Quad" || !this.bareTripleTerms.has(term)) {
      return term;
    }
    const innerSubject = this.reifyOccurrence(term.subject, graph);
    const innerObject = this.reifyOccurrence(term.object, graph);
    const innerTriple = quad(innerSubject, term.predicate, innerObject);
    const reifier = this.tripleTermReifiers.get(term) ??
      blankNode(`b${++this.bnodeCounter}`);
    this.quads.push(quad(reifier, namedNode(RDF_REIFIES), innerTriple, graph));
    return reifier;
  }

  // -------------------------------------------------------------------------
  // Scanner
  // -------------------------------------------------------------------------

  private skipWsAndComments(): void {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === "#") {
        while (this.pos < this.text.length && this.text[this.pos] !== "\n") {
          this.pos++;
        }
      } else if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private peek(): Token {
    const saved = this.pos;
    const tok = this.scan();
    this.pos = saved;
    return tok;
  }

  private next(): Token {
    const tok = this.scan();
    return tok;
  }

  private scan(): Token {
    this.skipWsAndComments();
    if (this.pos >= this.text.length) {
      return { type: "eof" };
    }
    const c = this.text[this.pos];
    if (c === "<") {
      if (this.text.startsWith("<<", this.pos)) {
        this.pos += 2;
        return { type: "punct", value: "<<" };
      }
      return this.scanIri();
    }
    if (c === ">") {
      if (this.text.startsWith(">>", this.pos)) {
        this.pos += 2;
        return { type: "punct", value: ">>" };
      }
      throw this.error("unexpected '>'");
    }
    if (c === "_" && this.text[this.pos + 1] === ":") {
      return this.scanBnode();
    }
    if (c === '"' || c === "'") {
      return this.scanLiteral(c);
    }
    if (c === "@") {
      return this.scanAtDirective();
    }
    if (c === ":") {
      return this.scanPname();
    }
    // RDF 1.2 annotation delimiters and the reifier marker.
    if (c === "{" && this.text[this.pos + 1] === "|") {
      this.pos += 2;
      return { type: "punct", value: "{|" };
    }
    if (c === "|" && this.text[this.pos + 1] === "}") {
      this.pos += 2;
      return { type: "punct", value: "|}" };
    }
    if (c === "|") {
      throw this.error("unexpected '|'");
    }
    if (c === "~") {
      this.pos++;
      return { type: "punct", value: "~" };
    }
    if (STRUCTURAL.has(c)) {
      this.pos++;
      return { type: "punct", value: c };
    }
    if (c === "+" || c === "-" || /[0-9]/.test(c)) {
      return this.scanNumber();
    }
    if (c === "." && /[0-9]/.test(this.text[this.pos + 1] ?? "")) {
      return this.scanNumber();
    }
    if (this.isNameStart(c)) {
      return this.scanWordOrPname();
    }
    throw this.error(`unexpected character '${c}'`);
  }

  private scanIri(): Token {
    this.expectChar("<");
    let value = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === ">") {
        this.pos++;
        return { type: "iri", value };
      }
      if (c === "\\") {
        value += this.scanEscape();
      } else {
        value += c;
        this.pos++;
      }
    }
    throw this.error("unterminated IRI");
  }

  private scanBnode(): Token {
    this.pos += 2; // skip _:
    const start = this.pos;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      // PN_LABEL allows '-' and '.' internally (but never a trailing '.').
      if (this.isNameChar(c) || c === "-" || c === ".") {
        this.pos++;
      } else {
        break;
      }
    }
    if (this.pos === start) {
      throw this.error("empty blank node label");
    }
    let label = this.text.slice(start, this.pos);
    if (label.endsWith(".")) {
      label = label.slice(0, -1);
      this.pos--;
    }
    return { type: "bnode", label };
  }

  private scanLiteral(quote: string): Token {
    // Long strings: three consecutive quotes.
    const isLong = this.text.startsWith(quote + quote + quote, this.pos);
    this.pos += isLong ? 3 : 1;
    let value = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (isLong) {
        if (this.text.startsWith(quote + quote + quote, this.pos)) {
          this.pos += 3;
          return this.literalWithSuffix(value);
        }
      } else if (c === quote) {
        this.pos++;
        return this.literalWithSuffix(value);
      }
      if (c === "\\") {
        value += this.scanEscape();
      } else {
        value += c;
        this.pos++;
      }
    }
    throw this.error("unterminated literal");
  }

  private literalWithSuffix(value: string): Token {
    // Optional language tag.
    if (this.text[this.pos] === "@") {
      this.pos++;
      const start = this.pos;
      while (
        this.pos < this.text.length &&
        /[a-zA-Z0-9-]/.test(this.text[this.pos])
      ) {
        this.pos++;
      }
      const lang = this.text.slice(start, this.pos).toLowerCase();
      return { type: "literal", value, lang };
    }
    // Optional datatype: ^^<iri> or ^^prefix:local.
    if (this.text.startsWith("^^", this.pos)) {
      this.pos += 2;
      this.skipInlineWs();
      if (this.text[this.pos] === "<") {
        const iri = this.scanIri();
        if (iri.type !== "iri") {
          throw this.error("invalid datatype IRI");
        }
        return {
          type: "literal",
          value,
          datatype: this.resolveIri(iri.value),
        };
      }
      const pname = this.scanPrefixedName();
      if (pname.type !== "pname") {
        throw this.error("invalid datatype prefixed name");
      }
      return {
        type: "literal",
        value,
        datatype: this.expandPname(pname.prefix, pname.local),
      };
    }
    return { type: "literal", value };
  }

  private scanAtDirective(): Token {
    this.pos++; // skip @
    const start = this.pos;
    while (
      this.pos < this.text.length && this.isNameChar(this.text[this.pos])
    ) {
      this.pos++;
    }
    const word = this.text.slice(start, this.pos).toLowerCase();
    if (word === "prefix" || word === "base") {
      return { type: "keyword", value: word === "prefix" ? "PREFIX" : "BASE" };
    }
    throw this.error(`unexpected '@${word}'`);
  }

  private scanNumber(): Token {
    const start = this.pos;
    if (this.text[this.pos] === "+" || this.text[this.pos] === "-") {
      this.pos++;
    }
    // Whole part (may be absent for `.5`).
    const wholeStart = this.pos;
    while (/[0-9]/.test(this.text[this.pos] ?? "")) {
      this.pos++;
    }
    let hasDot = false;
    let hasExp = false;
    if (
      this.text[this.pos] === "." && /[0-9]/.test(this.text[this.pos + 1] ?? "")
    ) {
      hasDot = true;
      this.pos++;
      while (/[0-9]/.test(this.text[this.pos] ?? "")) {
        this.pos++;
      }
    }
    const expChar = this.text[this.pos] ?? "";
    if (expChar === "e" || expChar === "E") {
      // Ensure an exponent actually follows (e.g. `1e5`); otherwise treat as a
      // bare word boundary (shouldn't happen for numbers).
      let look = this.pos + 1;
      if (this.text[look] === "+" || this.text[look] === "-") {
        look++;
      }
      if (/[0-9]/.test(this.text[look] ?? "")) {
        hasExp = true;
        this.pos = look;
        while (/[0-9]/.test(this.text[this.pos] ?? "")) {
          this.pos++;
        }
      }
    }
    if (this.pos === start || (wholeStart === this.pos && !hasDot && !hasExp)) {
      throw this.error("malformed number");
    }
    const value = this.text.slice(start, this.pos);
    const kind: "integer" | "decimal" | "double" = hasExp
      ? "double"
      : hasDot
      ? "decimal"
      : "integer";
    return { type: "number", value, kind };
  }

  private scanWordOrPname(): Token {
    const start = this.pos;
    while (
      this.pos < this.text.length && this.isNameChar(this.text[this.pos])
    ) {
      this.pos++;
    }
    const word = this.text.slice(start, this.pos);
    if (this.text[this.pos] === ":") {
      return this.scanPnameRest(word);
    }
    const upper = word.toUpperCase();
    if (upper === "PREFIX" || upper === "BASE" || upper === "GRAPH") {
      return { type: "keyword", value: upper };
    }
    if (word === "a" || word === "true" || word === "false") {
      return { type: "word", value: word };
    }
    throw this.error(`unexpected bare word '${word}'`);
  }

  private scanPname(): Token {
    return this.scanPnameRest("");
  }

  /**
   * scanPrefixedName reads a prefixed name that may or may not carry an
   * explicit prefix, e.g. both `xsd:boolean` and `:boolean` after `^^`.
   */
  private scanPrefixedName(): Token {
    const start = this.pos;
    while (
      this.pos < this.text.length && this.isNameChar(this.text[this.pos])
    ) {
      this.pos++;
    }
    const prefix = this.text.slice(start, this.pos);
    return this.scanPnameRest(prefix);
  }

  private scanPnameRest(prefix: string): Token {
    this.expectChar(":");
    const start = this.pos;
    while (
      this.pos < this.text.length &&
      this.isLocalChar(this.text[this.pos])
    ) {
      if (this.text[this.pos] === "\\") {
        break;
      }
      this.pos++;
    }
    let local = this.text.slice(start, this.pos);
    // A prefixed-name local part cannot end in '.', which is the triple
    // terminator: `:o3.` means pname `:o3` followed by '.'.
    if (local.endsWith(".")) {
      local = local.slice(0, -1);
      this.pos--;
    }
    return { type: "pname", prefix, local };
  }

  private scanEscape(): string {
    this.pos++; // skip backslash
    const c = this.text[this.pos];
    switch (c) {
      case "t":
        this.pos++;
        return "\t";
      case "b":
        this.pos++;
        return "\b";
      case "n":
        this.pos++;
        return "\n";
      case "r":
        this.pos++;
        return "\r";
      case "f":
        this.pos++;
        return "\f";
      case '"':
        this.pos++;
        return '"';
      case "'":
        this.pos++;
        return "'";
      case "\\":
        this.pos++;
        return "\\";
      case "u": {
        this.pos++;
        return String.fromCodePoint(parseInt(this.expectHex(4), 16));
      }
      case "U": {
        this.pos++;
        return String.fromCodePoint(parseInt(this.expectHex(8), 16));
      }
      default:
        throw this.error(`invalid escape '\\${c ?? ""}'`);
    }
  }

  private expectHex(count: number): string {
    const hex = this.text.slice(this.pos, this.pos + count);
    if (hex.length < count || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw this.error("invalid unicode escape");
    }
    this.pos += count;
    return hex;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private expectPname(): { prefix: string; local: string } {
    const tok = this.next();
    if (tok.type !== "pname") {
      throw this.error("expected a prefixed name");
    }
    return tok;
  }

  private expectIri(): string {
    const tok = this.next();
    if (tok.type !== "iri") {
      throw this.error("expected an IRI");
    }
    return this.resolveIri(tok.value);
  }

  private expect(value: string): void {
    const tok = this.next();
    if (tok.type !== "punct" || tok.value !== value) {
      throw this.error(`expected '${value}'`);
    }
  }

  private expectChar(value: string): void {
    if (this.text[this.pos] !== value) {
      throw this.error(`expected '${value}'`);
    }
    this.pos++;
  }

  private consumeOptionalDot(): void {
    const tok = this.peek();
    if (tok.type === "punct" && tok.value === ".") {
      this.next();
    }
  }

  private skipInlineWs(): void {
    while (this.text[this.pos] === " " || this.text[this.pos] === "\t") {
      this.pos++;
    }
  }

  private resolveIri(value: string): string {
    if (value === "") {
      return this.base;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
      return value;
    }
    if (!this.base) {
      return value;
    }
    try {
      return new URL(value, this.base).href;
    } catch {
      return this.base + value;
    }
  }

  private expandPname(prefix: string, local: string): string {
    const namespace = this.prefixes.get(prefix);
    if (namespace === undefined) {
      throw this.error(`undefined prefix '${prefix}'`);
    }
    return namespace + local;
  }

  private isNameStart(c: string): boolean {
    return /[a-zA-Z_]/.test(c) || c.charCodeAt(0) >= 0x80;
  }

  private isNameChar(c: string): boolean {
    return /[a-zA-Z0-9_]/.test(c) || c.charCodeAt(0) >= 0x80;
  }

  private isLocalChar(c: string): boolean {
    return !TERM_BOUNDARY.has(c) && c.charCodeAt(0) > 0x20;
  }

  private describe(tok: Token): string {
    return tok.type === "eof" ? "end of input" : JSON.stringify(tok);
  }

  private error(message: string): Error {
    const line = this.text.slice(0, this.pos).split("\n").length;
    return new Error(`Turtle parse error at line ${line}: ${message}`);
  }
}

/**
 * parseTurtleQuads parses Turtle, TriG, or N-Triples/N-Quads text into quads.
 * Relative IRIs resolve against `baseIri`; when no base is given, relative
 * IRIs are kept as-is.
 */
export function parseTurtleQuads(
  text: string,
  baseIri: string = "",
): rdfjs.Quad[] {
  return new TurtleTriGParser(text, baseIri).parse();
}

import type * as rdfjs from "@rdfjs/types";
import { DataFactory, type InternalDataFactory } from "@/term/data-factory.ts";

/**
 * Typed parse context and semantic actions for the generated Turtle / TriG /
 * N-Triples / N-Quads parser (`turtle-generated.ts`, from `turtle.jison`).
 *
 * The generated module is only a table-driven LR automaton plus a switch that
 * calls the functions below; everything that carries meaning lives here, in
 * ordinary type-checked TypeScript. A parse reads and writes one module-level
 * `turtleContext`, which `parseTurtleQuads` (`turtle-parser.ts`) resets before
 * each document. Parsing is synchronous and never re-enters, so a single
 * context is sufficient.
 *
 * The grammar mirrors the W3C RDF 1.2 TriG grammar (a superset of Turtle that
 * also accepts N-Triples), extended with an N-Quads-style graph label on
 * top-level statements so LOAD can ingest database-dump documents. The RDF 1.2
 * surface (triple terms, reifiers, annotation blocks) follows the spec's
 * state-machine parsing semantics (TriG 5.3): reifiers and annotations emit
 * `reifier rdf:reifies <<( s p o )>>` triples, and the node produced by a
 * reified triple `<< s p o >>` is its reifier.
 */

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = RDF + "type";
const RDF_FIRST = RDF + "first";
const RDF_REST = RDF + "rest";
const RDF_NIL = RDF + "nil";
const RDF_REIFIES = RDF + "reifies";
const RDF_LANGSTRING = RDF + "langString";
const RDF_DIRLANGSTRING = RDF + "dirLangString";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const XSD_INTEGER = XSD + "integer";
const XSD_DECIMAL = XSD + "decimal";
const XSD_DOUBLE = XSD + "double";
const XSD_BOOLEAN = XSD + "boolean";

/** PendingTriple is a buffered, not yet flushed triple. */
interface PendingTriple {
  subject: rdfjs.Term;
  predicate: rdfjs.Term;
  object: rdfjs.Term;
}

/**
 * TurtleSaveFrame is what the parser saves when it enters a nested construct
 * (annotation, blank node property list, collection) and restores when it
 * leaves. Each construct fills only the fields it restores.
 */
interface TurtleSaveFrame {
  subject: rdfjs.Term | undefined;
  predicate: rdfjs.Term | undefined;
  tripleTerm: rdfjs.Term | undefined;
  reifier: rdfjs.Term | undefined;
  node: rdfjs.Term | undefined;
}

/** TurtleReifierFrame saves the reifier context around a reified triple. */
interface TurtleReifierFrame {
  reifier: rdfjs.Term | undefined;
  tripleTerm: rdfjs.Term | undefined;
}

/** TurtleCollectionFrame accumulates the items of a collection being parsed. */
interface TurtleCollectionFrame {
  items: rdfjs.Term[];
}

/** TurtleParseState is the statement-level state machine of one parse. */
export interface TurtleParseState {
  graph: rdfjs.Term | undefined;
  subject: rdfjs.Term | undefined;
  predicate: rdfjs.Term | undefined;
  object: rdfjs.Term | undefined;
  reifier: rdfjs.Term | undefined;
  tripleTerm: rdfjs.Term | undefined;
  bnodeCounter: number;
  saveStack: TurtleSaveFrame[];
  reifierStack: TurtleReifierFrame[];
  collectionStack: TurtleCollectionFrame[];
  pending: PendingTriple[];
}

/** TurtleParseContext is everything one Turtle parse reads and writes. */
export interface TurtleParseContext {
  /** The RDF/JS data factory every term is built with. */
  factory: InternalDataFactory;
  /** The current base IRI (mutated by `@base` / `BASE`). */
  base: string;
  /** The `{ prefix: namespace }` map (mutated by `@prefix` / `PREFIX`). */
  prefixes: Map<string, string>;
  /** The output quads (reset per parse). */
  quads: rdfjs.Quad[];
  /** The statement-level state machine. */
  state: TurtleParseState;
}

/** createTurtleParseState returns the empty statement-level state. */
export function createTurtleParseState(): TurtleParseState {
  return {
    graph: undefined,
    subject: undefined,
    predicate: undefined,
    object: undefined,
    reifier: undefined,
    tripleTerm: undefined,
    bnodeCounter: 0,
    saveStack: [],
    reifierStack: [],
    collectionStack: [],
    pending: [],
  };
}

/**
 * turtleContext is the context of the parse in progress. Reset it with
 * `resetTurtleContext` before running the generated parser.
 */
export const turtleContext: TurtleParseContext = {
  factory: DataFactory,
  base: "",
  prefixes: new Map<string, string>(),
  quads: [],
  state: createTurtleParseState(),
};

/**
 * resetTurtleContext prepares `turtleContext` for a new document: a fresh
 * state, empty prefix map, empty quad buffer, and the given base IRI.
 */
export function resetTurtleContext(baseIri: string): undefined {
  turtleContext.factory = DataFactory;
  turtleContext.base = baseIri;
  turtleContext.prefixes = new Map<string, string>();
  turtleContext.quads = [];
  turtleContext.state = createTurtleParseState();
}

function graphTerm(): rdfjs.Term {
  const graph = turtleContext.state.graph;
  return graph === undefined ? turtleContext.factory.defaultGraph() : graph;
}

// Quads are buffered per statement and flushed by finishStatement so the
// N-Quads graph label (which appears after the object list) can set the
// graph before the quads are emitted.
function emitQuad(
  subject: rdfjs.Term,
  predicate: rdfjs.Term,
  object: rdfjs.Term,
): undefined {
  turtleContext.state.pending.push({ subject, predicate, object });
}

/** finishStatement flushes the buffered triples of the statement. */
export function finishStatement(): undefined {
  const state = turtleContext.state;
  const graph = graphTerm();
  for (let index = 0; index < state.pending.length; index++) {
    const triple = state.pending[index]!;
    turtleContext.quads.push(
      turtleContext.factory.quad(
        triple.subject,
        triple.predicate,
        triple.object,
        graph,
      ),
    );
  }
  state.pending = [];
}

/** finishStatementAndResetGraph flushes the statement, then clears the graph. */
export function finishStatementAndResetGraph(): undefined {
  finishStatement();
  turtleContext.state.graph = undefined;
}

/** resetGraph returns to the default graph. */
export function resetGraph(): undefined {
  turtleContext.state.graph = undefined;
}

/** setGraph records the current graph label and returns it. */
export function setGraph(graph: rdfjs.Term): rdfjs.Term {
  turtleContext.state.graph = graph;
  return graph;
}

/** setSubject records the statement subject and returns it. */
export function setSubject(subject: rdfjs.Term): rdfjs.Term {
  turtleContext.state.subject = subject;
  return subject;
}

/**
 * startStatementSubject records a label-or-subject in subject position and
 * resets the graph to the default (TriG 5.3.1).
 */
export function startStatementSubject(subject: rdfjs.Term): undefined {
  turtleContext.state.subject = subject;
  turtleContext.state.graph = undefined;
}

/** setPredicate records the statement predicate and returns it. */
export function setPredicate(predicate: rdfjs.Term): rdfjs.Term {
  turtleContext.state.predicate = predicate;
  return predicate;
}

/** rdfTypeTerm returns the `rdf:type` IRI (the `a` keyword). */
export function rdfTypeTerm(): rdfjs.Term {
  return turtleContext.factory.namedNode(RDF_TYPE);
}

/** freshBlankNode mints a blank node unique within the current document. */
export function freshBlankNode(): rdfjs.Term {
  turtleContext.state.bnodeCounter += 1;
  return turtleContext.factory.blankNode(
    "b" + turtleContext.state.bnodeCounter,
  );
}

/** labelledBlankNode builds the blank node of a `_:label` token. */
export function labelledBlankNode(token: string): rdfjs.Term {
  return turtleContext.factory.blankNode(token.slice(2));
}

/** makeQuad builds a triple term (a quad without a graph). */
export function makeQuad(
  subject: rdfjs.Term,
  predicate: rdfjs.Term,
  object: rdfjs.Term,
): rdfjs.Term {
  return turtleContext.factory.quad(subject, predicate, object);
}

// --- RFC 3986 §5.2-5.3 relative-reference resolution ---
// RDF 1.1 Turtle §6.3 (and RDF 1.2 Concepts) resolve relative IRIs with the
// RFC 3986 algorithm, not WHATWG URL normalization. The two disagree on edge
// cases such as a network-path reference with an empty path (`//host`, which
// RFC 3986 recomposes to `scheme://host` with no trailing slash while WHATWG
// appends "/"), so resolution is implemented from the RFC directly.

/** UriComponents are the five RFC 3986 components of a URI reference. */
interface UriComponents {
  scheme: string | undefined;
  authority: string | undefined;
  path: string;
  query: string | undefined;
  fragment: string | undefined;
}

// Splits a URI reference into its five RFC 3986 components.
function parseUriComponents(uri: string): UriComponents {
  const match =
    /^(?:([^:\/?#]+):)?(?:\/\/([^\/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$/
      .exec(uri);
  if (match === null) {
    throw new Error("Invalid URI reference: " + uri);
  }
  return {
    scheme: match[1],
    authority: match[2],
    path: match[3] || "",
    query: match[4],
    fragment: match[5],
  };
}

// RFC 3986 §5.2.4 remove_dot_segments.
function removeDotSegments(path: string): string {
  let input = path;
  let output = "";
  while (input.length > 0) {
    if (input.indexOf("../") === 0) {
      input = input.slice(3);
    } else if (input.indexOf("./") === 0) {
      input = input.slice(2);
    } else if (input.indexOf("/./") === 0) {
      input = "/" + input.slice(3);
    } else if (input === "/.") {
      input = "/";
    } else if (input.indexOf("/../") === 0) {
      input = "/" + input.slice(4);
      output = output.replace(/\/?[^\/]*$/, "");
    } else if (input === "/..") {
      input = "/";
      output = output.replace(/\/?[^\/]*$/, "");
    } else if (input === "." || input === "..") {
      input = "";
    } else {
      const segmentMatch = /^\/?[^\/]*/.exec(input);
      const segment = segmentMatch === null ? "" : segmentMatch[0];
      output += segment;
      input = input.slice(segment.length);
    }
  }
  return output;
}

// RFC 3986 §5.2.3 merge (base path with a relative reference path).
function mergePaths(base: UriComponents, referencePath: string): string {
  if (base.authority !== undefined && base.path === "") {
    return "/" + referencePath;
  }
  return base.path.slice(0, base.path.lastIndexOf("/") + 1) + referencePath;
}

// RFC 3986 §5.2.2 transform + §5.3 recomposition.
function resolveRfc3986(baseIri: string, reference: string): string {
  const base = parseUriComponents(baseIri);
  const ref = parseUriComponents(reference);
  let scheme: string | undefined;
  let authority: string | undefined;
  let path = "";
  let query: string | undefined;

  if (ref.scheme !== undefined) {
    scheme = ref.scheme;
    authority = ref.authority;
    path = removeDotSegments(ref.path);
    query = ref.query;
  } else {
    if (ref.authority !== undefined) {
      authority = ref.authority;
      path = removeDotSegments(ref.path);
      query = ref.query;
    } else {
      if (ref.path === "") {
        path = base.path;
        query = ref.query !== undefined ? ref.query : base.query;
      } else {
        path = ref.path.charAt(0) === "/"
          ? removeDotSegments(ref.path)
          : removeDotSegments(mergePaths(base, ref.path));
        query = ref.query;
      }
      authority = base.authority;
    }
    scheme = base.scheme;
  }
  const fragment = ref.fragment;

  let result = "";
  if (scheme !== undefined) result += scheme + ":";
  if (authority !== undefined) result += "//" + authority;
  result += path;
  if (query !== undefined) result += "?" + query;
  if (fragment !== undefined) result += "#" + fragment;
  return result;
}

/**
 * resolveIri resolves a possibly relative IRI against the current base. An IRI
 * that already has a scheme is already resolved (this also keeps opaque-scheme
 * IRIs such as urn: untouched).
 */
export function resolveIri(iri: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(iri)) return iri;
  if (!turtleContext.base) return iri;
  try {
    return resolveRfc3986(turtleContext.base, iri);
  } catch (_error) {
    return turtleContext.base + iri;
  }
}

function decodeUnicodeEscape(
  matched: string,
  fourDigits: string | undefined,
  eightDigits: string | undefined,
): string {
  const codePoint = parseInt(fourDigits ?? eightDigits ?? "", 16);
  if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
    throw new Error(
      "Invalid Unicode escape (surrogate code point): " + matched,
    );
  }
  return String.fromCodePoint(codePoint);
}

// Replaces every `\uXXXX` / `\UXXXXXXXX` escape with its character.
function decodeUnicodeEscapes(text: string): string {
  const pattern = /\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g;
  let result = "";
  let copiedUpTo = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    result += text.slice(copiedUpTo, match.index) +
      decodeUnicodeEscape(match[0], match[1], match[2]);
    copiedUpTo = match.index + match[0].length;
    match = pattern.exec(text);
  }
  return result + text.slice(copiedUpTo);
}

function echarValue(character: string): string {
  switch (character) {
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "f":
      return "\f";
    default:
      return character;
  }
}

// Replaces every `\t \b \n \r \f \" \' \\` escape with its character.
function decodeStringEscapes(text: string): string {
  const pattern = /\\([tbnrf"'\\])/g;
  let result = "";
  let copiedUpTo = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    result += text.slice(copiedUpTo, match.index) +
      echarValue(match[1]!);
    copiedUpTo = match.index + match[0].length;
    match = pattern.exec(text);
  }
  return result + text.slice(copiedUpTo);
}

/**
 * unescapeString strips the quotes of a string token and decodes its `\u`,
 * `\U` and ECHAR escapes.
 */
export function unescapeString(raw: string): string {
  const quoteLength = raw.startsWith("'''") || raw.startsWith('"""') ? 3 : 1;
  const body = raw.slice(quoteLength, raw.length - quoteLength);
  return decodeStringEscapes(decodeUnicodeEscapes(body));
}

/** unescapeIri decodes the `\u` / `\U` escapes of the text between `<` and `>`. */
export function unescapeIri(iri: string): string {
  const result = decodeUnicodeEscapes(iri);
  // IRIREF excludes U+0000-U+0020 and <>"{}|^`\\; an escape must not
  // smuggle any of them into the decoded IRI.
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u0020<>"{}|^`\\]/.test(result)) {
    throw new Error("Invalid IRI escape: disallowed character");
  }
  return result;
}

/** iriFromToken builds the named node of an `<IRIREF>` token. */
export function iriFromToken(token: string): rdfjs.Term {
  return turtleContext.factory.namedNode(
    resolveIri(unescapeIri(token.slice(1, -1))),
  );
}

/** prefixedName builds the named node of a `prefix:local` token. */
export function prefixedName(token: string): rdfjs.Term {
  const colon = token.indexOf(":");
  const prefix = token.slice(0, colon);
  const namespace = turtleContext.prefixes.get(prefix);
  if (namespace === undefined) {
    throw new Error("Undefined prefix: " + prefix + ":");
  }
  // PN_LOCAL_ESC sequences (\_ \~ \. \- \! \$ \& \' \( \) \* \+ \, \; \= \/ \? \# \@ \%)
  // denote the literal character (TriG 4.5 PN_LOCAL_ESC); percent-escapes are
  // kept as-is.
  return turtleContext.factory.namedNode(
    namespace +
      token.slice(colon + 1).replace(/\\([_~.\-!$&'()*+,;=/?#@%])/g, "$1"),
  );
}

/** addPrefix records a `@prefix` / `PREFIX` declaration. */
export function addPrefix(prefixToken: string, iriToken: string): undefined {
  const prefix = prefixToken.slice(0, -1);
  turtleContext.prefixes.set(prefix, resolveIri(iriToken.slice(1, -1)));
}

/** setBase records a `@base` / `BASE` declaration and returns the new base. */
export function setBase(iriToken: string): string {
  turtleContext.base = resolveIri(iriToken.slice(1, -1));
  return turtleContext.base;
}

// --- RDF 1.2 literal well-formedness (Turtle 3.3 / N-Triples term
//     constructors): language tags MUST be well-formed per BCP47
//     (RFC 5646 section 2.2.9), and rdf:langString / rdf:dirLangString
//     MUST NOT be written as explicit datatype IRIs. ---

// RFC 5646 section 2.2.8 grandfathered "irregular" tags, which do not match the
// langtag ABNF but are nonetheless well-formed.
function isIrregularLanguageTag(tag: string): boolean {
  switch (tag) {
    case "en-GB-oed":
    case "i-ami":
    case "i-bnn":
    case "i-default":
    case "i-enochian":
    case "i-hak":
    case "i-klingon":
    case "i-lux":
    case "i-mingo":
    case "i-navajo":
    case "i-pwn":
    case "i-tao":
    case "i-tay":
    case "i-tsu":
    case "sgn-BE-FR":
    case "sgn-BE-NL":
    case "sgn-CH-DE":
      return true;
    default:
      return false;
  }
}

function isWellFormedLanguageTag(tag: string): boolean {
  const alpha = /^[A-Za-z]+$/;
  const alphanumeric = /^[A-Za-z0-9]+$/;
  const digits = /^[0-9]+$/;
  if (isIrregularLanguageTag(tag)) return true;

  // privateuse = "x" 1*("-" 1*8alphanum)
  if (/^x(-[A-Za-z0-9]{1,8})+$/.test(tag)) return true;

  const subtags = tag.split("-");
  let index = 0;
  // language = 2*3ALPHA ["-" extlang] / 4ALPHA / 5*8ALPHA
  const language = subtags[index]!;
  index++;
  if (language.length >= 2 && language.length <= 3) {
    if (!alpha.test(language)) return false;
    // extlang = 3ALPHA *2("-" 3ALPHA)
    let extlangs = 0;
    while (
      index < subtags.length && extlangs < 3 &&
      subtags[index]!.length === 3 && alpha.test(subtags[index]!)
    ) {
      index++;
      extlangs++;
    }
  } else if (language.length === 4) {
    if (!alpha.test(language)) return false;
  } else if (language.length >= 5 && language.length <= 8) {
    if (!alpha.test(language)) return false;
  } else {
    return false;
  }

  // script = 4ALPHA
  if (
    index < subtags.length && subtags[index]!.length === 4 &&
    alpha.test(subtags[index]!)
  ) {
    index++;
  }

  // region = 2ALPHA / 3DIGIT
  if (index < subtags.length) {
    const region = subtags[index]!;
    if (
      (region.length === 2 && alpha.test(region)) ||
      (region.length === 3 && digits.test(region))
    ) {
      index++;
    }
  }

  // variant = 5*8alphanum / (DIGIT 3alphanum)
  while (index < subtags.length) {
    const variant = subtags[index]!;
    const isVariant = (variant.length >= 5 && variant.length <= 8 &&
      alphanumeric.test(variant)) ||
      (variant.length === 4 && digits.test(variant.charAt(0)) &&
        alphanumeric.test(variant));
    if (!isVariant) break;
    index++;
  }

  // extension = singleton 1*("-" 2*8alphanum), where singleton is a single
  // alphanumeric other than x/X.
  while (
    index < subtags.length && /^[0-9A-WY-Za-wy-z]$/.test(subtags[index]!)
  ) {
    index++;
    let extensionCount = 0;
    while (
      index < subtags.length && subtags[index]!.length >= 2 &&
      subtags[index]!.length <= 8 && alphanumeric.test(subtags[index]!)
    ) {
      index++;
      extensionCount++;
    }
    if (extensionCount === 0) return false;
  }

  // privateuse = "x" 1*("-" 1*8alphanum)
  if (index < subtags.length && subtags[index] === "x") {
    index++;
    let privateUseCount = 0;
    while (
      index < subtags.length && subtags[index]!.length >= 1 &&
      subtags[index]!.length <= 8 && alphanumeric.test(subtags[index]!)
    ) {
      index++;
      privateUseCount++;
    }
    if (privateUseCount === 0) return false;
  }

  return index === subtags.length;
}

// The LANG_DIR token after its leading '@' (e.g. "en--ltr"). The optional
// "--ltr"/"--rtl" direction suffix is guaranteed by the LANG_DIR terminal;
// only the language-tag portion is validated here, and a directional-language
// pair is returned so the factory can set the rdf:dirLangString datatype when
// a direction is present.
function languageWithDirection(
  languageDirection: string,
): rdfjs.DirectionalLanguage {
  const dash = languageDirection.indexOf("--");
  const tag = dash === -1
    ? languageDirection
    : languageDirection.slice(0, dash);
  if (!isWellFormedLanguageTag(tag)) {
    throw new Error("Language tag is not well-formed per BCP47: " + tag);
  }
  if (dash === -1) {
    return { language: tag };
  }
  return {
    language: tag,
    direction: languageDirection.slice(dash + 2) === "rtl" ? "rtl" : "ltr",
  };
}

/** stringLiteral builds a plain (xsd:string) literal from a string token. */
export function stringLiteral(token: string): rdfjs.Term {
  return turtleContext.factory.literal(unescapeString(token));
}

/** languageLiteral builds a language-tagged literal from STRING LANG_DIR. */
export function languageLiteral(
  token: string,
  languageDirectionToken: string,
): rdfjs.Term {
  return turtleContext.factory.literal(
    unescapeString(token),
    languageWithDirection(languageDirectionToken.slice(1)),
  );
}

/** datatypedLiteral builds a literal with an explicit datatype IRI. */
export function datatypedLiteral(
  token: string,
  datatype: rdfjs.Term,
): rdfjs.Term {
  if (
    datatype.value === RDF_LANGSTRING || datatype.value === RDF_DIRLANGSTRING
  ) {
    throw new Error(
      "rdf:langString and rdf:dirLangString must not be written as an explicit datatype IRI",
    );
  }
  return turtleContext.factory.literal(
    unescapeString(token),
    datatype as rdfjs.NamedNode,
  );
}

/** integerLiteral builds an xsd:integer literal from an INTEGER token. */
export function integerLiteral(token: string): rdfjs.Term {
  return turtleContext.factory.literal(
    token,
    turtleContext.factory.namedNode(XSD_INTEGER),
  );
}

/** decimalLiteral builds an xsd:decimal literal from a DECIMAL token. */
export function decimalLiteral(token: string): rdfjs.Term {
  return turtleContext.factory.literal(
    token,
    turtleContext.factory.namedNode(XSD_DECIMAL),
  );
}

/** doubleLiteral builds an xsd:double literal from a DOUBLE token. */
export function doubleLiteral(token: string): rdfjs.Term {
  return turtleContext.factory.literal(
    token,
    turtleContext.factory.namedNode(XSD_DOUBLE),
  );
}

/** booleanLiteral builds an xsd:boolean literal from a BOOLEAN token. */
export function booleanLiteral(token: string): rdfjs.Term {
  return turtleContext.factory.literal(
    token,
    turtleContext.factory.namedNode(XSD_BOOLEAN),
  );
}

// --- RDF 1.2 reifier / annotation state machine (TriG 5.3.4-5.3.7) ---

function startAnnotation(): undefined {
  const state = turtleContext.state;
  state.saveStack.push({
    subject: state.subject,
    predicate: state.predicate,
    tripleTerm: state.tripleTerm,
    reifier: state.reifier,
    node: undefined,
  });
  state.tripleTerm = turtleContext.factory.quad(
    state.subject!,
    state.predicate!,
    state.object!,
  );
  state.reifier = undefined;
}

/** endAnnotation restores the statement context saved by the object. */
export function endAnnotation(): undefined {
  const state = turtleContext.state;
  const saved = state.saveStack.pop();
  if (saved === undefined) {
    throw new Error("Unbalanced annotation");
  }
  state.subject = saved.subject;
  state.predicate = saved.predicate;
  state.tripleTerm = saved.tripleTerm;
  state.reifier = saved.reifier;
}

/** startAnnotationBlock opens `{| ... |}`, minting a reifier if none exists. */
export function startAnnotationBlock(): undefined {
  const state = turtleContext.state;
  if (state.reifier === undefined) {
    state.reifier = freshBlankNode();
    emitQuad(
      state.reifier,
      turtleContext.factory.namedNode(RDF_REIFIES),
      state.tripleTerm!,
    );
  }
  state.subject = state.reifier;
}

/** endAnnotationBlock closes `{| ... |}`. */
export function endAnnotationBlock(): undefined {
  turtleContext.state.reifier = undefined;
}

/** applyReifier handles `~ [reifier]` after a triple. */
export function applyReifier(reifierTerm: rdfjs.Term | undefined): undefined {
  const state = turtleContext.state;
  state.reifier = reifierTerm === undefined ? freshBlankNode() : reifierTerm;
  emitQuad(
    state.reifier,
    turtleContext.factory.namedNode(RDF_REIFIES),
    state.tripleTerm!,
  );
}

/** startReifiedTriple opens `<< s p o >>`. */
export function startReifiedTriple(): undefined {
  const state = turtleContext.state;
  state.reifierStack.push({
    reifier: state.reifier,
    tripleTerm: state.tripleTerm,
  });
  state.reifier = undefined;
}

/** setTripleTerm records the triple term of a reified triple body. */
export function setTripleTerm(tripleTerm: rdfjs.Term): rdfjs.Term {
  turtleContext.state.tripleTerm = tripleTerm;
  return tripleTerm;
}

// Finishing a reified triple (TriG 5.3.5): if no `~ reifier` was matched,
// assign a fresh blank node; the reifying triple was already emitted by the
// reifier production when a reifier was present. The node produced by the
// production is the reifier.
/** finishReifiedTriple closes `<< s p o >>` and returns its reifier. */
export function finishReifiedTriple(): rdfjs.Term {
  const state = turtleContext.state;
  if (state.reifier === undefined) {
    state.reifier = freshBlankNode();
    emitQuad(
      state.reifier,
      turtleContext.factory.namedNode(RDF_REIFIES),
      state.tripleTerm!,
    );
  }
  const node = state.reifier;
  const saved = state.reifierStack.pop();
  if (saved === undefined) {
    throw new Error("Unbalanced reified triple");
  }
  state.reifier = saved.reifier;
  state.tripleTerm = saved.tripleTerm;
  return node;
}

// Emits the triple for a parsed object and prepares the annotation context
// (TriG 5.3.3 / 5.3.6). Returns the object value.
/** emitObject emits the statement triple for an object and opens its annotation. */
export function emitObject(object: rdfjs.Term): rdfjs.Term {
  const state = turtleContext.state;
  state.object = object;
  emitQuad(state.subject!, state.predicate!, object);
  startAnnotation();
  return object;
}

// --- blank node property lists (TriG 5.3.8) ---

// Each list's node rides on the save stack with the enclosing subject and
// predicate: a single "current list node" slot would be overwritten by a
// nested list, so `[ p [ q o ] ]` would return the inner node (#210).
/** startBlankNodePropertyList opens `[ ... ]`. */
export function startBlankNodePropertyList(): undefined {
  const state = turtleContext.state;
  const node = freshBlankNode();
  state.saveStack.push({
    subject: state.subject,
    predicate: state.predicate,
    tripleTerm: undefined,
    reifier: undefined,
    node,
  });
  state.subject = node;
}

/** endBlankNodePropertyList closes `[ ... ]` and returns its node. */
export function endBlankNodePropertyList(): rdfjs.Term {
  const state = turtleContext.state;
  const saved = state.saveStack.pop();
  if (saved === undefined || saved.node === undefined) {
    throw new Error("Unbalanced blank node property list");
  }
  state.subject = saved.subject;
  state.predicate = saved.predicate;
  return saved.node;
}

// --- collections (TriG 5.3.9) ---

/** startCollection opens `( ... )`. */
export function startCollection(): undefined {
  const state = turtleContext.state;
  state.saveStack.push({
    subject: state.subject,
    predicate: state.predicate,
    tripleTerm: undefined,
    reifier: undefined,
    node: undefined,
  });
  state.collectionStack.push({ items: [] });
}

/** collectionAdd appends one item to the collection being parsed. */
export function collectionAdd(item: rdfjs.Term): undefined {
  const stack = turtleContext.state.collectionStack;
  stack[stack.length - 1]!.items.push(item);
}

/** endCollection closes `( ... )`, emits its rdf:first/rest chain, returns its head. */
export function endCollection(): rdfjs.Term {
  const state = turtleContext.state;
  const collection = state.collectionStack.pop();
  const saved = state.saveStack.pop();
  if (collection === undefined || saved === undefined) {
    throw new Error("Unbalanced collection");
  }
  state.subject = saved.subject;
  state.predicate = saved.predicate;
  const items = collection.items;
  if (items.length === 0) {
    return turtleContext.factory.namedNode(RDF_NIL);
  }
  const head = freshBlankNode();
  let current = head;
  for (let index = 0; index < items.length; index++) {
    emitQuad(
      current,
      turtleContext.factory.namedNode(RDF_FIRST),
      items[index]!,
    );
    if (index < items.length - 1) {
      const next = freshBlankNode();
      emitQuad(current, turtleContext.factory.namedNode(RDF_REST), next);
      current = next;
    } else {
      emitQuad(
        current,
        turtleContext.factory.namedNode(RDF_REST),
        turtleContext.factory.namedNode(RDF_NIL),
      );
    }
  }
  return head;
}

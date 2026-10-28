import type {
  AggregateExpression,
  AskQuery,
  BgpPattern,
  BindPattern,
  ClearDropOperation,
  ConstructQuery,
  CopyMoveOperation,
  CreateOperation,
  DescribeQuery,
  ExistsExpression,
  Expression,
  FilterPattern,
  FromClause,
  FunctionCallExpression,
  GraphPattern,
  GroupPattern,
  InsertDeleteOperation,
  LoadOperation,
  MembershipExpression,
  MinusPattern,
  OperationExpression,
  OptionalPattern,
  Ordering,
  Pattern,
  PropertyPath,
  Query,
  ReifiedQuad,
  SelectQuery,
  ServicePattern,
  SparqlQuery,
  Term,
  Triple,
  UnionPattern,
  UpdateOperation,
  UpdateQuery,
  ValuePatternRow,
  ValuesPattern,
  VariableExpression,
  VariableTerm,
  Wildcard,
} from "./ast.ts";
import type { RdfLiteral, RdfNamedNode, RdfVariable } from "./rdf-terms.ts";
import {
  blankNodeTerm,
  languageLiteralTerm,
  literalTerm,
  namedNodeTerm,
  quadTerm,
  variableTerm,
} from "./term-values.ts";

/**
 * Typed parse context and semantic actions for the generated SPARQL parser
 * (`parser.ts`, from `sparql.jison`).
 *
 * The generated module is only a table-driven LR automaton plus a switch that
 * calls the functions below; everything that carries meaning lives here, in
 * ordinary type-checked TypeScript. These functions replace the jison grammar
 * prologue and the `Parser.*` statics of sparqljs's generated parser: a parse
 * reads and writes one module-level `sparqlContext`, which `mod.ts` resets
 * before each parse. Parsing is synchronous and never re-enters, so a single
 * context is sufficient.
 */

// Common namespaces and entities
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = RDF + "type";
const RDF_FIRST = RDF + "first";
const RDF_REST = RDF + "rest";
const RDF_NIL = RDF + "nil";
const RDF_REIFIES = RDF + "reifies";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const XSD_INTEGER = XSD + "integer";
const XSD_DECIMAL = XSD + "decimal";
const XSD_DOUBLE = XSD + "double";
const XSD_BOOLEAN = XSD + "boolean";

// --- Parser value types (what grammar symbols leave on the value stack) ---

/** NamedNodeTerm is an IRI term. */
export type NamedNodeTerm = RdfNamedNode;
/** VariableNode is a query variable term. */
export type VariableNode = RdfVariable;
/** LiteralTerm is a literal term. */
export type LiteralTerm = RdfLiteral;
/** QuadTerm is a quoted triple or triple term. */
export type QuadTerm = ReifiedQuad;

/**
 * ReifierPart is a `~` reifier clause of an annotation: the reifier term, or
 * null for a bare `~` (the evaluator mints a fresh reifier).
 */
export interface ReifierPart {
  reifier: Term | null;
}

/** AnnotationPart is a reifier clause or the property list of a `{| |}` block. */
export type AnnotationPart = ReifierPart | ParsedTriple[];

/**
 * ParsedTriple is a triple under construction: the subject may still be
 * missing (it is the subject of the enclosing property list), and an
 * annotation clause may be attached.
 */
export interface ParsedTriple {
  subject?: Term;
  predicate?: Term | PropertyPath;
  object?: Term;
  annotations?: AnnotationPart[];
}

/** EntityNode is a graph node with the triples that describe it. */
export interface EntityNode {
  entity: Term;
  triples: ParsedTriple[];
}

/** AnnotatedNode is an object together with its annotation clause. */
export interface AnnotatedNode {
  annotation: AnnotationPart[];
  object: EntityNode;
}

/** ObjectEntry is one entry of an object list. */
export type ObjectEntry = EntityNode | AnnotatedNode;

/** PathVerbObjects is a property-path (or variable) verb with its objects. */
export interface PathVerbObjects {
  verb: Term | PropertyPath;
  objects: ObjectEntry[];
}

/** OperatorTail is the `op operand` tail of a left-associative expression. */
export interface OperatorTail {
  operator: string;
  operand: Expression;
}

/** DatasetEntry is one `FROM [NAMED] <iri>` / `USING [NAMED] <iri>` clause. */
export interface DatasetEntry {
  iri: Term;
  named: boolean;
}

/** WithValue is the `WITH <iri>` clause of a modify operation. */
export interface WithValue {
  graph: Term;
}

/** ArgListValue is an argument list, before the callee is attached. */
export interface ArgListValue {
  type: "functionCall";
  args: Expression[];
  distinct?: boolean;
}

/** GraphReference is a `GRAPH <iri>` / `DEFAULT` / `NAMED` / `ALL` target. */
export interface GraphReference {
  type?: "graph";
  name?: Term;
  default?: boolean;
  named?: boolean;
  all?: boolean;
}

/** GraphOrDefaultValue is a `DEFAULT` / `[GRAPH] <iri>` target. */
export interface GraphOrDefaultValue {
  type: "graph";
  default?: boolean;
  name?: Term;
}

/** QuadsGraph is a `GRAPH g { ... }` block of a quad pattern. */
export interface QuadsGraph {
  type: "graph";
  triples: Triple[];
  name: Term;
}

/** QuadBlock is a basic graph pattern or graph block of a quad pattern. */
export type QuadBlock = BgpPattern | QuadsGraph;

/** InsertDeleteParts is the delete/insert part of a modify operation. */
export interface InsertDeleteParts {
  delete: QuadBlock[];
  insert: QuadBlock[];
}

/**
 * QueryFragment is a piece of a query under construction. The clause rules of
 * the grammar each produce one; the query rule merges them.
 */
export interface QueryFragment {
  queryType?: "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";
  type?: "query" | "values";
  variables?: Array<VariableTerm | Wildcard | VariableExpression>;
  describe?: Array<Term | Wildcard>;
  template?: Triple[];
  where?: Pattern[];
  group?: Grouping[];
  having?: Expression[];
  order?: Ordering[];
  limit?: number;
  offset?: number;
  values?: ValuePatternRow[];
  distinct?: boolean;
  reduced?: boolean;
  from?: FromClause;
  base?: string;
  prefixes?: Record<string, string> | null;
}

/** Grouping is one GROUP BY condition. */
export interface Grouping {
  expression: Expression;
  variable?: VariableTerm;
}

/** InlineDataValue is the value of an inline data block. */
export type InlineDataValue = ValuePatternRow[] | ValuesPattern;

/** SparqlResult is what a successful parse leaves in the context. */
export type SparqlResult = SparqlQuery | PropertyPath | NamedNodeTerm;

/** SparqlParseContext is everything one SPARQL parse reads and writes. */
export interface SparqlParseContext {
  /** The current base IRI (mutated by the `BASE` directive). */
  base: string;
  /** The pre-registered prefixes (the `xsd:` prefix and the options'). */
  presetPrefixes: Map<string, string>;
  /** The prefixes declared by `PREFIX` directives, in declaration order. */
  declaredPrefixes: Map<string, string>;
  /** Whether RDF-star / SPARQL 1.2 triple syntax is enabled. */
  sparqlStar: boolean;
  /** Whether the input is a bare property path (never set by the wrapper). */
  pathOnly: boolean;
  /** Whether projection validation is skipped. */
  skipValidation: boolean;
  /** The result of the parse in progress, set by the entry rule. */
  result: SparqlResult | undefined;
}

/**
 * sparqlContext is the context of the parse in progress. Reset it with
 * `resetSparqlContext` before running the generated parser.
 */
export const sparqlContext: SparqlParseContext = {
  base: "",
  presetPrefixes: new Map<string, string>(),
  declaredPrefixes: new Map<string, string>(),
  sparqlStar: false,
  pathOnly: false,
  skipValidation: false,
  result: undefined,
};

/** SparqlParseSettings are the per-parse options the wrapper sets. */
export interface SparqlParseSettings {
  base: string;
  prefixes: Map<string, string>;
  sparqlStar: boolean;
  skipValidation: boolean;
}

/**
 * resetSparqlContext prepares `sparqlContext` for a new parse. The blank node
 * counter is deliberately not reset: labels stay unique across parses until
 * `resetBlankNodes` is called.
 */
export function resetSparqlContext(settings: SparqlParseSettings): undefined {
  sparqlContext.base = settings.base;
  sparqlContext.presetPrefixes = settings.prefixes;
  sparqlContext.declaredPrefixes = new Map<string, string>();
  sparqlContext.sparqlStar = settings.sparqlStar;
  sparqlContext.pathOnly = false;
  sparqlContext.skipValidation = settings.skipValidation;
  sparqlContext.result = undefined;
}

// --- Wildcard ---

/**
 * WILDCARD is the `*` of `SELECT *`, `DESCRIBE *` and `COUNT(*)`: one shared
 * record, so a wildcard is recognised by its `termType`.
 */
const WILDCARD: Wildcard = { termType: "Wildcard", value: "*" };

/** wildcard returns the wildcard singleton. */
export function wildcard(): Wildcard {
  return WILDCARD;
}

// --- Small helpers ---

/** lowercase returns a lowercase version of the given string. */
export function lowercase(text: string): string {
  return text.toLowerCase();
}

/** toInt converts the string to a number. */
export function toInt(text: string): number {
  return parseInt(text, 10);
}

/** present reports whether an optional keyword token was matched. */
export function present(token: string | undefined): boolean {
  return token !== undefined;
}

// IRI resolution (sparqljs's simplified resolution against the base)
let resolvedBase = "";
let resolvedBasePath = "";
let resolvedBaseRoot = "";

/** resolveIRI resolves an IRI token (angular brackets optional) against the base. */
export function resolveIRI(token: string): string {
  let iri = token;
  // Strip off possible angular brackets
  if (iri.charAt(0) === "<") {
    iri = iri.substring(1, iri.length - 1);
  }
  // Return absolute IRIs unmodified
  if (/^[a-z][a-z0-9.+-]*:/i.test(iri)) {
    return iri;
  }
  const base = sparqlContext.base;
  if (!base) {
    throw new Error(
      "Cannot resolve relative IRI " + iri + " because no base IRI was set.",
    );
  }
  if (resolvedBase !== base) {
    resolvedBase = base;
    resolvedBasePath = base.replace(/[^\/:]*$/, "");
    const rootMatch = /^(?:[a-z]+:\/*)?[^\/]*/.exec(base);
    resolvedBaseRoot = rootMatch === null ? "" : rootMatch[0];
  }
  if (iri.length === 0) {
    // An empty relative IRI indicates the base IRI
    return base;
  }
  switch (iri.charAt(0)) {
    // Resolve relative fragment IRIs against the base IRI
    case "#":
      return base + iri;
    // Resolve relative query string IRIs by replacing the query string
    case "?":
      return base.replace(/(?:\?.*)?$/, iri);
    // Resolve root relative IRIs at the root of the base IRI
    case "/":
      return resolvedBaseRoot + iri;
    // Resolve all other IRIs at the base IRI's path
    default:
      return resolvedBasePath + iri;
  }
}

// Blank node labels
let blankId = 0;

/** resetBlankNodes restarts the generated blank node label counter. */
export function resetBlankNodes(): undefined {
  blankId = 0;
}

/** blank creates a new generated blank node. */
export function blank(): Term {
  const label = "g_" + blankId;
  blankId += 1;
  return blankNodeTerm(label);
}

/** labelledBlank builds the blank node of a `_:label` token. */
export function labelledBlank(token: string): Term {
  const name = token.replace(/^(_:)/, "");
  if (name.startsWith("e_")) {
    return blankNodeTerm(name);
  }
  return blankNodeTerm("e_" + name);
}

/** variableOf builds the variable of a `?x` / `$x` token. */
export function variableOf(token: string): VariableNode {
  return variableTerm(token.substring(1));
}

/** namedNodeOf builds an IRI term. */
export function namedNodeOf(iri: string): NamedNodeTerm {
  return namedNodeTerm(iri);
}

/** rdfTypeTerm returns the `rdf:type` IRI (the `a` keyword). */
export function rdfTypeTerm(): NamedNodeTerm {
  return namedNodeTerm(RDF_TYPE);
}

/** rdfNilTerm returns the `rdf:nil` IRI (the `()` token). */
export function rdfNilTerm(): NamedNodeTerm {
  return namedNodeTerm(RDF_NIL);
}

/** iriFromToken builds the IRI of an `<iri>` token. */
export function iriFromToken(token: string): NamedNodeTerm {
  return namedNodeTerm(resolveIRI(token));
}

// --- Directives and prefixed names ---

/** setBase records the `BASE` directive. */
export function setBase(iriToken: string): undefined {
  sparqlContext.base = resolveIRI(iriToken);
}

/** declarePrefix records a `PREFIX` directive. */
export function declarePrefix(
  prefixToken: string,
  iriToken: string,
): undefined {
  const prefix = prefixToken.substring(0, prefixToken.length - 1);
  const iri = resolveIRI(iriToken);
  sparqlContext.declaredPrefixes.set(prefix, iri);
}

function lookupPrefix(prefix: string): string | undefined {
  const declared = sparqlContext.declaredPrefixes.get(prefix);
  if (declared !== undefined) {
    return declared;
  }
  return sparqlContext.presetPrefixes.get(prefix);
}

/** prefixedNameLocal expands a `prefix:local` token. */
export function prefixedNameLocal(token: string): NamedNodeTerm {
  const namePos = token.indexOf(":");
  const prefix = token.substring(0, namePos);
  const expansion = lookupPrefix(prefix);
  if (!expansion) {
    throw new Error("Unknown prefix: " + prefix);
  }
  const uriString = resolveIRI(expansion + token.substring(namePos + 1));
  return namedNodeTerm(uriString);
}

/** prefixedNameNamespace expands a `prefix:` token. */
export function prefixedNameNamespace(token: string): NamedNodeTerm {
  const prefix = token.substring(0, token.length - 1);
  const expansion = lookupPrefix(prefix);
  if (expansion === undefined) {
    throw new Error("Unknown prefix: " + prefix);
  }
  return namedNodeTerm(resolveIRI(expansion));
}

// --- Literals ---

/** typedLiteral builds a literal with a datatype IRI (or a plain string). */
export function typedLiteral(value: string, datatype?: string): Term {
  if (datatype === undefined) {
    return literalTerm(value);
  }
  return literalTerm(value, namedNodeTerm(datatype));
}

/** typedLiteralOf builds a literal whose datatype is already a term. */
export function typedLiteralOf(value: string, datatype: Term): LiteralTerm {
  return literalTerm(
    value,
    datatype.termType === "NamedNode"
      ? datatype
      : namedNodeTerm(datatype.value),
  );
}

/**
 * languageLiteral builds a language-tagged literal; a trailing `--ltr` /
 * `--rtl` (guaranteed by the LANGTAG terminal) becomes the RDF 1.2 base
 * direction, yielding an rdf:dirLangString literal.
 */
export function languageLiteral(value: string, tagToken: string): Term {
  const lang = tagToken.substring(1).toLowerCase();
  const dash = lang.indexOf("--");
  if (dash === -1) {
    return languageLiteralTerm(value, lang, "");
  }
  const direction = lang.slice(dash + 2);
  return languageLiteralTerm(
    value,
    lang.slice(0, dash),
    direction === "rtl" ? "rtl" : "ltr",
  );
}

/** integerLiteral builds an xsd:integer literal. */
export function integerLiteral(text: string): Term {
  return typedLiteral(text, XSD_INTEGER);
}

/** decimalLiteral builds an xsd:decimal literal. */
export function decimalLiteral(text: string): Term {
  return typedLiteral(text, XSD_DECIMAL);
}

/** doubleLiteral builds an xsd:double literal (lower-cased exponent). */
export function doubleLiteral(text: string): Term {
  return typedLiteral(text.toLowerCase(), XSD_DOUBLE);
}

/** signedIntegerLiteral builds an xsd:integer literal without its `+`. */
export function signedIntegerLiteral(text: string): Term {
  return typedLiteral(text.substring(1), XSD_INTEGER);
}

/** signedDecimalLiteral builds an xsd:decimal literal without its `+`. */
export function signedDecimalLiteral(text: string): Term {
  return typedLiteral(text.substring(1), XSD_DECIMAL);
}

/** signedDoubleLiteral builds an xsd:double literal without its `+`. */
export function signedDoubleLiteral(text: string): Term {
  return typedLiteral(text.substring(1).toLowerCase(), XSD_DOUBLE);
}

/** booleanLiteral builds an xsd:boolean literal. */
export function booleanLiteral(text: string): Term {
  return typedLiteral(text.toLowerCase(), XSD_BOOLEAN);
}

const ESCAPE_SEQUENCE = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})|\\(.)/g;
const PARTIAL_SURROGATES_WITHOUT_ENDPOINT =
  /[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/;

function escapeReplacement(character: string): string {
  switch (character) {
    case "\\":
      return "\\";
    case "'":
      return "'";
    case '"':
      return '"';
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
      return "";
  }
}

// Translates the escape codes in a string body; an invalid escape yields "".
function translateEscapes(body: string): string {
  const pattern = new RegExp(ESCAPE_SEQUENCE.source, "g");
  let result = "";
  let copiedUpTo = 0;
  let match = pattern.exec(body);
  while (match !== null) {
    result += body.slice(copiedUpTo, match.index);
    const unicode4 = match[1];
    const unicode8 = match[2];
    const escapedChar = match[3];
    if (unicode4) {
      result += String.fromCharCode(parseInt(unicode4, 16));
    } else if (unicode8) {
      let charCode = parseInt(unicode8, 16);
      if (charCode < 0xFFFF) {
        result += String.fromCharCode(charCode);
      } else {
        charCode -= 0x10000;
        result += String.fromCharCode(
          0xD800 + (charCode >> 10),
          0xDC00 + (charCode & 0x3FF),
        );
      }
    } else {
      const replacement = escapeReplacement(escapedChar ?? "");
      if (!replacement) {
        return "";
      }
      result += replacement;
    }
    copiedUpTo = match.index + match[0].length;
    match = pattern.exec(body);
  }
  return result + body.slice(copiedUpTo);
}

/**
 * unescapeString strips `trimLength` quote characters from both ends of a
 * string literal token and translates its escape codes.
 */
export function unescapeString(token: string, trimLength: number): string {
  const body = token.substring(trimLength, token.length - trimLength);
  const text = translateEscapes(body);
  // Test for invalid unicode surrogate pairs
  if (PARTIAL_SURROGATES_WITHOUT_ENDPOINT.exec(text)) {
    throw new Error(
      "Invalid unicode codepoint of surrogate pair without corresponding codepoint in " +
        text,
    );
  }
  return text;
}

// --- Triples ---

/** triple creates a triple with the given components (missing ones omitted). */
export function triple(
  subject: Term | undefined,
  predicate: Term | PropertyPath | undefined,
  object: Term | undefined,
  annotations?: AnnotationPart[],
): ParsedTriple {
  const result: ParsedTriple = {};
  if (subject !== undefined) result.subject = subject;
  if (predicate !== undefined) result.predicate = predicate;
  if (object !== undefined) result.object = object;
  if (annotations !== undefined) result.annotations = annotations;
  return result;
}

/** withSubject gives a partial triple the subject of its property list. */
function withSubject(subject: Term, partial: ParsedTriple): ParsedTriple {
  const result: ParsedTriple = { subject };
  if (partial.subject !== undefined) result.subject = partial.subject;
  if (partial.predicate !== undefined) result.predicate = partial.predicate;
  if (partial.object !== undefined) result.object = partial.object;
  if (partial.annotations !== undefined) {
    result.annotations = partial.annotations;
  }
  return result;
}

function withSubjectAll(
  subject: Term,
  partials: ParsedTriple[],
): ParsedTriple[] {
  const result: ParsedTriple[] = [];
  for (let index = 0; index < partials.length; index++) {
    result.push(withSubject(subject, partials[index]!));
  }
  return result;
}

/** asTriples views completed parsed triples as AST triples. */
function asTriples(triples: ParsedTriple[]): Triple[] {
  return triples as Triple[];
}

/** nestedTriple builds a quoted triple. */
export function nestedTriple(
  subject: Term,
  predicate: Term,
  object: Term,
): QuadTerm {
  return quadTerm(subject, predicate, object);
}

/**
 * tripleTerm marks a quad as a data triple term (`<<( s p o )>>`), distinct
 * from a reified-triple pattern (`<< s p o >>`). The evaluator treats triple
 * terms as data (they are never expanded into `rdf:reifies` statements).
 */
export function tripleTerm(
  subject: Term,
  predicate: Term,
  object: Term,
): QuadTerm {
  const term = nestedTriple(subject, predicate, object);
  term.tripleTerm = true;
  return term;
}

/**
 * reifiedTriple builds a quoted triple pattern with a reifier binding
 * (`<< s p o ~ r >>`): the quad carries the reifier term so the evaluator
 * binds it instead of minting a fresh internal reifier.
 */
export function reifiedTriple(
  subject: Term,
  predicate: Term,
  object: Term,
  reifier: Term,
): QuadTerm {
  const quad = nestedTriple(subject, predicate, object);
  quad.reifier = reifier;
  return quad;
}

/** quotedTriple builds a quoted triple, which requires SPARQL-star. */
export function quotedTriple(
  subject: Term,
  predicate: Term,
  object: Term,
): QuadTerm {
  requireSparqlStar();
  return nestedTriple(subject, predicate, object);
}

/** quotedTripleWithReifier builds `<< s p o ~ r >>`, which requires SPARQL-star. */
export function quotedTripleWithReifier(
  subject: Term,
  predicate: Term,
  object: Term,
  reifier: Term,
): QuadTerm {
  requireSparqlStar();
  return reifiedTriple(subject, predicate, object, reifier);
}

/**
 * reifiedTriplePattern expands a standalone reified-triple pattern
 * (`<< s p o >>` or `<< s p o ~ r >>` with an empty property list) into the
 * single `reifier rdf:reifies <<( s p o )>>` pattern triple it denotes.
 * Without a reifier the quad itself stands in for the subject, so the
 * evaluator mints a fresh internal reifier at evaluation time.
 */
export function reifiedTriplePattern(quad: QuadTerm): Triple[] {
  const reifier = quad.reifier || quad;
  // Build a fresh quad for the triple term (the marker properties of the
  // quoted triple must not carry over).
  const quoted = nestedTriple(quad.subject, quad.predicate, quad.object);
  return asTriples([
    triple(reifier, namedNodeOf(RDF_REIFIES), quoted),
  ]);
}

/** requireSparqlStar throws unless SPARQL-star syntax is enabled. */
function requireSparqlStar(): undefined {
  if (!sparqlContext.sparqlStar) {
    throw new Error("SPARQL-star support is not enabled");
  }
}

/** annotationBlock checks SPARQL-star support for a `{| |}` annotation block. */
export function annotationBlock(properties: ParsedTriple[]): ParsedTriple[] {
  requireSparqlStar();
  return properties;
}

/** reifierClause builds the `~ reifier?` annotation part. */
export function reifierClause(reifier: Term | undefined): ReifierPart {
  return { reifier: reifier || null };
}

// Each `{| ... |}` block parses to an array of annotation triples; the
// annotation parts list holds one such array per block. Flatten them so
// applyAnnotationTriples iterates annotation triples directly.
function flatAnnotations(blocks: ParsedTriple[][]): ParsedTriple[] {
  const triples: ParsedTriple[] = [];
  for (const block of blocks) {
    for (const item of block) triples.push(item);
  }
  return triples;
}

function applyAnnotationTriples(
  subject: Term,
  annotations: ParsedTriple[],
  output: ParsedTriple[],
): undefined {
  for (const annotation of annotations) {
    // If the annotation already has a subject then just push the annotation
    // to the upper scope as it is a blank node introduced from a pattern like
    // :s :p :o {| :p1 [ :p2 :o2; :p3 :o3 ] |}
    output.push(triple(
      annotation.subject !== undefined ? annotation.subject : subject,
      annotation.predicate,
      annotation.object,
    ));

    if (annotation.annotations) {
      const predicate = annotation.predicate;
      const object = annotation.object;
      if (
        predicate === undefined || object === undefined ||
        !("termType" in predicate)
      ) {
        throw new Error("Nested triples cannot contain paths");
      }
      applyAnnotationTriples(
        nestedTriple(subject, predicate, object),
        flatPropertyLists(annotation.annotations),
        output,
      );
    }
  }
}

// Nested annotation clauses hold property lists only.
function flatPropertyLists(parts: AnnotationPart[]): ParsedTriple[] {
  const blocks: ParsedTriple[][] = [];
  for (const part of parts) {
    if (Array.isArray(part)) blocks.push(part);
  }
  return flatAnnotations(blocks);
}

/**
 * applyAnnotations expands annotation clauses into `rdf:reifies` and
 * annotation triples when SPARQL-star is enabled; otherwise it returns the
 * triples unchanged.
 */
export function applyAnnotations(triples: ParsedTriple[]): Triple[] {
  if (!sparqlContext.sparqlStar) {
    return asTriples(triples);
  }
  const newTriples: ParsedTriple[] = [];
  for (const t of triples) {
    newTriples.push(triple(t.subject, t.predicate, t.object));
    const annotations = t.annotations;
    if (!annotations) {
      continue;
    }
    // Annotation parts (SPARQL 1.2 [111]) are `{ reifier: term|null }` for `~`
    // clauses and property-list arrays for `{| ... |}` blocks.
    let reifierTerm: Term | null = null;
    let hasReifier = false;
    const blocks: ParsedTriple[][] = [];
    for (const part of annotations) {
      if (Array.isArray(part)) {
        blocks.push(part);
      } else {
        hasReifier = true;
        reifierTerm = part.reifier;
      }
    }

    const subject = t.subject;
    const predicate = t.predicate;
    const object = t.object;
    if (
      subject === undefined || predicate === undefined ||
      object === undefined ||
      !("termType" in predicate)
    ) {
      throw new Error("Nested triples cannot contain paths");
    }

    // The reified triple term the annotation(s) attach to. A named reifier
    // (`~ r`) travels on the quad so the evaluator binds it; otherwise the
    // evaluator mints a fresh reifier at evaluation time.
    const quoted = hasReifier && reifierTerm
      ? reifiedTriple(subject, predicate, object, reifierTerm)
      : nestedTriple(subject, predicate, object);

    if (hasReifier) {
      // `s p o ~ r` / `s p o ~` - emit the `reifier rdf:reifies <<( s p o )>>`
      // pattern triple; a bare `~` lets the quad stand in for the reifier so
      // the evaluator mints a fresh one.
      for (const pattern of reifiedTriplePattern(quoted)) {
        newTriples.push(pattern);
      }
      if (blocks.length) {
        applyAnnotationTriples(
          reifierTerm || quoted,
          flatAnnotations(blocks),
          newTriples,
        );
      }
    } else if (blocks.length) {
      applyAnnotationTriples(quoted, flatAnnotations(blocks), newTriples);
    }
  }
  return asTriples(newTriples);
}

/** subjectTriples gives every triple of a property list its subject. */
export function subjectTriples(
  subject: Term,
  properties: ParsedTriple[],
): Triple[] {
  return applyAnnotations(withSubjectAll(subject, properties));
}

/**
 * nodeSubjectTriples builds the triples of a blank-node subject (a collection
 * or `[ ... ]`) with an optional property list.
 */
export function nodeSubjectTriples(
  node: EntityNode,
  properties: ParsedTriple[] | undefined,
): Triple[] {
  if (properties === undefined) {
    return asTriples(node.triples);
  }
  const triples = withSubjectAll(node.entity, properties);
  for (const nested of node.triples) triples.push(nested);
  return applyAnnotations(triples);
}

/** quotedSubjectTriples builds the triples of a quoted-triple subject. */
export function quotedSubjectTriples(
  quad: QuadTerm,
  properties: ParsedTriple[] | undefined,
): Triple[] {
  if (properties === undefined) {
    return reifiedTriplePattern(quad);
  }
  return applyAnnotations(withSubjectAll(quad, properties));
}

/** pathNodeSubjectTriples is nodeSubjectTriples for the path grammar. */
export function pathNodeSubjectTriples(
  node: EntityNode,
  properties: ParsedTriple[] | undefined,
): Triple[] {
  return nodeSubjectTriples(node, properties);
}

/** createList builds an RDF collection from its items. */
export function createList(objects: EntityNode[]): EntityNode {
  const list = blank();
  let head = list;
  const listItems: Term[] = [];
  const triples: ParsedTriple[] = [];
  for (const object of objects) {
    listItems.push(object.entity);
    for (const nested of object.triples) triples.push(nested);
  }

  // Build an RDF list out of the items
  const listTriples: ParsedTriple[] = [];
  const count = listItems.length;
  for (let index = 0; index < count;) {
    const item = listItems[index]!;
    listTriples.push(triple(head, namedNodeOf(RDF_FIRST), item));
    const current = head;
    index += 1;
    head = index < count ? blank() : namedNodeOf(RDF_NIL);
    listTriples.push(triple(current, namedNodeOf(RDF_REST), head));
  }

  // Return the list's identifier, its triples, and the triples associated with
  // its items
  for (const nested of triples) listTriples.push(nested);
  return { entity: list, triples: listTriples };
}

/**
 * createAnonymousObject creates a blank node identifier, collecting triples
 * with that blank node as subject.
 */
export function createAnonymousObject(
  propertyList: ParsedTriple[],
): EntityNode {
  const entity = blank();
  return { entity, triples: withSubjectAll(entity, propertyList) };
}

/** plainNode wraps a term as a graph node without extra triples. */
export function plainNode(entity: Term): EntityNode {
  return { entity, triples: [] };
}

/** appendObject appends an object to the object list built so far. */
export function appendObject(
  objects: ObjectEntry[],
  last: ObjectEntry,
): ObjectEntry[] {
  objects.push(last);
  return objects;
}

/** appendAnnotation appends a part to the annotation clause built so far. */
export function appendAnnotation(
  parts: AnnotationPart[],
  part: AnnotationPart,
): AnnotationPart[] {
  return parts.concat([part]);
}

/** pathVerbObjects pairs a path (or variable) verb with its object list. */
export function pathVerbObjects(
  verb: Term | PropertyPath,
  objects: ObjectEntry[],
): PathVerbObjects {
  return { verb, objects };
}

/** annotatedObject attaches an annotation clause to an object, if present. */
export function annotatedObject(
  object: EntityNode,
  annotation: AnnotationPart[] | undefined,
): ObjectEntry {
  return annotation ? { annotation, object } : object;
}

/**
 * objectListToTriples collects all (possibly blank) objects, and triples that
 * have them as subject.
 */
export function objectListToTriples(
  predicate: Term | PropertyPath,
  objectList: ObjectEntry[],
  otherTriples?: ParsedTriple[][],
): ParsedTriple[] {
  const objects: ParsedTriple[] = [];
  const triples: ParsedTriple[] = [];
  for (const entry of objectList) {
    let annotation: AnnotationPart[] | undefined = undefined;
    let node: EntityNode;
    if ("annotation" in entry) {
      annotation = entry.annotation;
      node = entry.object;
    } else {
      node = entry;
    }
    objects.push(triple(undefined, predicate, node.entity, annotation));
    for (const nested of node.triples) triples.push(nested);
  }
  const result: ParsedTriple[] = [];
  for (const item of objects) result.push(item);
  if (otherTriples !== undefined) {
    for (const list of otherTriples) {
      for (const item of list) result.push(item);
    }
  }
  for (const item of triples) result.push(item);
  return result;
}

/** propertyListTriples joins the verb-object lists of a property list. */
export function propertyListTriples(
  first: ParsedTriple[],
  rest: ParsedTriple[][],
): ParsedTriple[] {
  const result: ParsedTriple[] = [];
  for (const item of first) result.push(item);
  for (const list of rest) {
    for (const item of list) result.push(item);
  }
  return result;
}

/** pathPropertyListTriples joins the verb-object lists of a path property list. */
export function pathPropertyListTriples(
  first: PathVerbObjects,
  rest: ParsedTriple[][],
): ParsedTriple[] {
  return objectListToTriples(first.verb, first.objects, rest);
}

/** pathVerbObjectTriples builds the triples of one `; path objects` tail. */
export function pathVerbObjectTriples(first: PathVerbObjects): ParsedTriple[] {
  return objectListToTriples(first.verb, first.objects);
}

/** flattenTripleLists concatenates lists of triples (and a final list). */
export function flattenTripleLists(
  lists: Triple[][],
  last: Triple[],
): Triple[] {
  const result: Triple[] = [];
  for (const list of lists) {
    for (const item of list) result.push(item);
  }
  for (const item of last) result.push(item);
  return result;
}

/** optionalTriples returns a copy of an optional list of triples. */
export function optionalTriples(
  list: ParsedTriple[] | undefined,
): ParsedTriple[] {
  const result: ParsedTriple[] = [];
  if (list !== undefined) {
    for (const item of list) result.push(item);
  }
  return result;
}

/** basicGraphPattern builds a basic graph pattern. */
export function basicGraphPattern(
  lists: Triple[][],
  last: Triple[],
): BgpPattern {
  return { type: "bgp", triples: flattenTripleLists(lists, last) };
}

// --- Property paths ---

/** pathOf creates a path with the given type and items. */
export function pathOf(
  type: string,
  items: Array<NamedNodeTerm | PropertyPath>,
): PropertyPath {
  return { type: "path", pathType: pathTypeOf(type), items };
}

function pathTypeOf(type: string): PropertyPath["pathType"] {
  switch (type) {
    case "|":
      return "|";
    case "/":
      return "/";
    case "^":
      return "^";
    case "+":
      return "+";
    case "*":
      return "*";
    case "?":
      return "?";
    default:
      return "!";
  }
}

/** alternativePath builds `a | b | ...`, or the single sequence. */
export function alternativePath(
  alternatives: Array<NamedNodeTerm | PropertyPath>,
  last: NamedNodeTerm | PropertyPath,
): NamedNodeTerm | PropertyPath {
  if (alternatives.length === 0) {
    return last;
  }
  alternatives.push(last);
  return pathOf("|", alternatives);
}

/** sequencePath builds `a / b / ...`, or the single element. */
export function sequencePath(
  elements: Array<NamedNodeTerm | PropertyPath>,
  last: NamedNodeTerm | PropertyPath,
): NamedNodeTerm | PropertyPath {
  if (elements.length === 0) {
    return last;
  }
  elements.push(last);
  return pathOf("/", elements);
}

/** modifiedPath applies a `?` / `*` / `+` modifier, if present. */
export function modifiedPath(
  primary: NamedNodeTerm | PropertyPath,
  modifier: string | undefined,
): NamedNodeTerm | PropertyPath {
  return modifier ? pathOf(modifier, [primary]) : primary;
}

/** inversePath applies a `^` prefix, if present. */
export function inversePath(
  inverse: string | undefined,
  element: NamedNodeTerm | PropertyPath,
): NamedNodeTerm | PropertyPath {
  return inverse ? pathOf(inverse, [element]) : element;
}

/** negatedPath builds `!set`. */
export function negatedPath(
  operator: string,
  set: NamedNodeTerm | PropertyPath | Array<NamedNodeTerm | PropertyPath>,
): PropertyPath {
  // An empty set `!()` is kept as the empty list the grammar has always built.
  return pathOf(operator, [set as NamedNodeTerm | PropertyPath]);
}

/** negatedPropertySet builds `( a | b | ... )` inside a `!`. */
export function negatedPropertySet(
  members: Array<NamedNodeTerm | PropertyPath>,
  last: NamedNodeTerm | PropertyPath | undefined,
): PropertyPath {
  // A missing last member is kept as `undefined`, as the grammar always has.
  members.push(last as NamedNodeTerm | PropertyPath);
  return pathOf("|", members);
}

// --- Expressions ---

/** operation creates an operation with the given name and arguments. */
export function operation(
  operatorName: string,
  args?: Expression[],
): OperationExpression {
  return { type: "operation", operator: operatorName, args: args || [] };
}

/** createOperationTree turns a list of operators and operands into a tree. */
export function createOperationTree(
  initialExpression: Expression,
  operationList: OperatorTail[],
): Expression {
  let result = initialExpression;
  for (const item of operationList) {
    result = operation(item.operator, [result, item.operand]);
  }
  return result;
}

/** operatorTail builds one `op operand` tail. */
export function operatorTail(
  operator: string,
  operand: Expression,
): OperatorTail {
  return { operator, operand };
}

/** signedTail builds a tail `+ literal ...` / `- literal ...`. */
export function signedTail(
  operator: string,
  literal: Term,
  rest: OperatorTail[],
): OperatorTail {
  return { operator, operand: createOperationTree(literal, rest) };
}

/** negatedLiteralTail builds a tail for a negative numeric literal. */
export function negatedLiteralTail(
  literal: Term,
  rest: OperatorTail[],
): OperatorTail {
  const negated = typedLiteralOf(
    literal.value.replace("-", ""),
    (literal as LiteralTerm).datatype,
  );
  return { operator: "-", operand: createOperationTree(negated, rest) };
}

/** relationalOperation builds `a op b`. */
export function binaryOperation(
  operator: string,
  left: Expression,
  right: Expression,
): OperationExpression {
  return operation(operator, [left, right]);
}

/** membershipOperation builds `a [NOT] IN (...)`. */
export function membershipOperation(
  left: Expression,
  negated: string | undefined,
  list: Expression[],
): MembershipExpression {
  return {
    type: "operation",
    operator: negated ? "notin" : "in",
    args: [left, list],
  };
}

/** starOperation builds an operation of the SPARQL-star builtins. */
export function starOperation(
  name: string,
  args: Expression[],
): OperationExpression {
  requireSparqlStar();
  return operation(lowercase(name), args);
}

/** existsOperation builds `[NOT] EXISTS { ... }`. */
export function existsOperation(
  negated: string | undefined,
  group: GroupPattern,
): ExistsExpression {
  return {
    type: "operation",
    operator: negated ? "notexists" : "exists",
    args: [degroupSingle(group)],
  };
}

/** boundOperation builds `BOUND(?x)`. */
export function boundOperation(variableToken: string): OperationExpression {
  return operation("bound", [variableOf(variableToken)]);
}

/** unaryOperation builds `! e`, `+ e` and `- e`. */
export function unaryOperation(
  operatorName: string,
  operand: Expression,
): OperationExpression {
  return operation(operatorName, [operand]);
}

/** argList builds a parenthesised argument list. */
export function argList(
  distinct: string | undefined,
  leading: Expression[],
  last: Expression,
): ArgListValue {
  leading.push(last);
  return { type: "functionCall", args: leading, distinct: present(distinct) };
}

/** emptyArgList builds the argument list `()`. */
export function emptyArgList(): ArgListValue {
  return { type: "functionCall", args: [] };
}

/** functionCall attaches the callee to an argument list. */
export function functionCall(
  callee: Term,
  args: ArgListValue,
): FunctionCallExpression {
  if (args.distinct === undefined) {
    return { type: args.type, args: args.args, function: callee };
  }
  return {
    type: args.type,
    args: args.args,
    distinct: args.distinct,
    function: callee,
  };
}

/** expressionList builds `( e, e, ... )`. */
export function expressionList(
  leading: Expression[],
  last: Expression,
): Expression[] {
  leading.push(last);
  return leading;
}

/** aggregate builds a COUNT / SUM / ... aggregate expression. */
export function aggregate(
  name: string,
  distinct: string | undefined,
  argument: Expression | string,
  separator?: string | undefined,
  withSeparator?: boolean,
): AggregateExpression {
  const result: AggregateExpression = {
    expression: typeof argument === "string" ? WILDCARD : argument,
    type: "aggregate",
    aggregation: lowercase(name),
    distinct: present(distinct),
  };
  if (withSeparator) {
    result.separator = typeof separator === "string" ? separator : " ";
  }
  return result;
}

/** degroupSingle transforms a possibly single group into its pattern. */
export function degroupSingle(group: GroupPattern): Pattern {
  return group.type === "group" && group.patterns.length === 1
    ? group.patterns[0]!
    : group;
}

// --- Select clauses and solution modifiers ---

/** mergeFragments merges query fragments into the first one (later wins). */
export function mergeFragments(
  base: QueryFragment | undefined,
  ...parts: Array<QueryFragment | undefined>
): QueryFragment {
  const target: QueryFragment = base === undefined ? {} : base;
  for (const part of parts) {
    if (part === undefined) continue;
    if (part.queryType !== undefined) target.queryType = part.queryType;
    if (part.type !== undefined) target.type = part.type;
    if (part.variables !== undefined) target.variables = part.variables;
    if (part.describe !== undefined) target.describe = part.describe;
    if (part.template !== undefined) target.template = part.template;
    if (part.where !== undefined) target.where = part.where;
    if (part.group !== undefined) target.group = part.group;
    if (part.having !== undefined) target.having = part.having;
    if (part.order !== undefined) target.order = part.order;
    if (part.limit !== undefined) target.limit = part.limit;
    if (part.offset !== undefined) target.offset = part.offset;
    if (part.values !== undefined) target.values = part.values;
    if (part.distinct !== undefined) target.distinct = part.distinct;
    if (part.reduced !== undefined) target.reduced = part.reduced;
    if (part.from !== undefined) target.from = part.from;
    if (part.base !== undefined) target.base = part.base;
    if (part.prefixes !== undefined) target.prefixes = part.prefixes;
  }
  return target;
}

/** datasetFragment groups `FROM` clauses into default and named graphs. */
export function datasetFragment(clauses: DatasetEntry[]): QueryFragment {
  const grouped = groupDatasets(clauses);
  return grouped === undefined ? {} : { from: grouped };
}

/** groupDatasets groups dataset clauses by default and named. */
export function groupDatasets(
  clauses: DatasetEntry[],
): FromClause | undefined {
  if (clauses.length === 0) {
    return undefined;
  }
  const defaults: Term[] = [];
  const named: Term[] = [];
  for (const clause of clauses) {
    (clause.named ? named : defaults).push(clause.iri);
  }
  return { default: defaults, named };
}

/** datasetEntry builds a `FROM` / `USING` clause. */
export function datasetEntry(
  named: string | undefined,
  iri: Term,
): DatasetEntry {
  return { iri, named: present(named) };
}

/** selectBase builds the `SELECT [DISTINCT|REDUCED]` start of a query. */
export function selectBase(modifier: string | undefined): QueryFragment {
  const fragment: QueryFragment = { queryType: "SELECT" };
  if (modifier !== undefined) {
    if (lowercase(modifier) === "distinct") {
      fragment.distinct = true;
    } else {
      fragment.reduced = true;
    }
  }
  return fragment;
}

/** selectWildcard builds `SELECT *`. */
export function selectWildcard(base: QueryFragment): QueryFragment {
  return mergeFragments(base, { variables: [WILDCARD] });
}

// The name a projection item binds: a variable's name or an `AS` alias.
function projectionName(
  item: VariableTerm | Wildcard | VariableExpression,
): string {
  if ("value" in item && item.value) {
    return item.value;
  }
  if ("variable" in item) {
    return item.variable.value;
  }
  return "";
}

// Returns the duplicates in the array
function getDuplicatesInArray(array: string[]): string[] {
  const sortedArray = array.slice().sort();
  const duplicates: string[] = [];
  for (let index = 0; index < sortedArray.length - 1; index++) {
    if (sortedArray[index + 1] === sortedArray[index]) {
      duplicates.push(sortedArray[index]!);
    }
  }
  return duplicates;
}

/** selectVariables builds `SELECT item+`, rejecting duplicate column names. */
export function selectVariables(
  base: QueryFragment,
  items: Array<VariableTerm | VariableExpression>,
): QueryFragment {
  // Check if id of each selected column is different
  const selectedVarIds: string[] = [];
  for (const item of items) selectedVarIds.push(projectionName(item));
  const duplicates = getDuplicatesInArray(selectedVarIds);
  if (duplicates.length > 0) {
    throw Error(
      "Two or more of the resulting columns have the same name (?" +
        duplicates[0] + ")",
    );
  }
  return mergeFragments(base, { variables: items });
}

/** selectItemExpression builds `( Expression AS Var )`. */
export function selectItemExpression(
  expression: Expression,
  variable: VariableTerm,
): VariableExpression {
  return { expression, variable };
}

/** groupingFrom builds a GROUP BY condition. */
export function groupingFrom(
  expression: Expression,
  variable?: VariableTerm,
): Grouping {
  const grouping: Grouping = { expression };
  if (variable !== undefined) grouping.variable = variable;
  return grouping;
}

/** orderingFrom builds an ORDER BY condition. */
export function orderingFrom(
  expression: Expression,
  descending: boolean,
): Ordering {
  const ordering: Ordering = { expression };
  if (descending) ordering.descending = true;
  return ordering;
}

// The id of a grouping condition.
function groupingId(grouping: Grouping): string | undefined {
  if (grouping.variable) {
    return grouping.variable.value;
  }
  return termValueOf(grouping.expression);
}

function termValueOf(expression: Expression): string | undefined {
  return "termType" in expression ? expression.value : undefined;
}

function isGroupedBy(groups: Grouping[], id: string | undefined): boolean {
  for (const group of groups) {
    if (groupingId(group) === id) return true;
  }
  return false;
}

// An operation argument: an expression, or (for EXISTS and IN) a pattern or a
// list of expressions.
type OperationArgument = Expression | Expression[] | Pattern;

type AnyOperation =
  | OperationExpression
  | ExistsExpression
  | MembershipExpression;

function isExistsOperation(
  operation: AnyOperation,
): operation is ExistsExpression {
  return operation.operator === "exists" || operation.operator === "notexists";
}

function isMembershipOperation(
  operation: AnyOperation,
): operation is MembershipExpression {
  return operation.operator === "in" || operation.operator === "notin";
}

// Get all "aggregate"s from an expression
function getAggregatesOfExpression(
  expression: OperationArgument | undefined,
): AggregateExpression[] {
  if (!expression || Array.isArray(expression)) {
    return [];
  }
  if ("type" in expression) {
    if (expression.type === "aggregate") {
      return [expression];
    } else if (expression.type === "operation") {
      // The pattern of EXISTS and the list of IN hold no aggregates.
      if (isExistsOperation(expression)) {
        return [];
      }
      if (isMembershipOperation(expression)) {
        return getAggregatesOfExpression(expression.args[0]);
      }
      const aggregates: AggregateExpression[] = [];
      for (const arg of expression.args) {
        for (const nested of getAggregatesOfExpression(arg)) {
          aggregates.push(nested);
        }
      }
      return aggregates;
    }
  }
  return [];
}

// Get all variables used in an expression
function collectVariables(
  expression: OperationArgument | undefined,
  variables: Set<Term>,
): undefined {
  if (!expression || Array.isArray(expression)) {
    return;
  }
  if ("termType" in expression) {
    if (expression.termType === "Variable") {
      variables.add(expression);
    }
  } else if (expression.type === "operation") {
    if (isExistsOperation(expression)) {
      return;
    }
    if (isMembershipOperation(expression)) {
      collectVariables(expression.args[0], variables);
      return;
    }
    for (const arg of expression.args) collectVariables(arg, variables);
  }
}

function selectionExpression(
  item: VariableTerm | Wildcard | VariableExpression,
): Expression | undefined {
  return "expression" in item ? item.expression : undefined;
}

// COUNT(*) holds the wildcard in place of an expression.
function isWildcardExpression(expression: Expression | Wildcard): boolean {
  return "termType" in expression &&
    (expression.termType as string) === "Wildcard";
}

// Checks the projection of a grouped (or aggregating) query.
function checkProjection(
  variables: Array<VariableTerm | Wildcard | VariableExpression>,
  groups: Grouping[] | undefined,
): undefined {
  let counts = false;
  for (const item of variables) {
    for (
      const aggregation of getAggregatesOfExpression(selectionExpression(item))
    ) {
      if (
        aggregation.aggregation === "count" &&
        !isWildcardExpression(aggregation.expression)
      ) {
        counts = true;
      }
    }
  }
  if (!counts && !groups) {
    return;
  }
  for (const selectVar of variables) {
    if ("termType" in selectVar && selectVar.termType === "Variable") {
      if (!groups || !isGroupedBy(groups, selectVar.value)) {
        throw Error(
          "Projection of ungrouped variable (?" + selectVar.value + ")",
        );
      }
    } else {
      const expression = selectionExpression(selectVar);
      if (getAggregatesOfExpression(expression).length === 0) {
        const usedVars = new Set<Term>();
        collectVariables(expression, usedVars);
        for (const usedVar of usedVars) {
          if (!groups || !isGroupedBy(groups, usedVar.value)) {
            throw Error(
              "Use of ungrouped variable in projection of operation (?" +
                usedVar.value + ")",
            );
          }
        }
      }
    }
  }
}

// Checks that the target of each `AS` is not already bound by a subquery.
function checkSubqueryAliases(
  variables: Array<VariableTerm | Wildcard | VariableExpression>,
  where: Pattern[],
): undefined {
  const subqueries: SelectQuery[] = [];
  for (const pattern of where) {
    if (pattern.type === "query") subqueries.push(pattern);
  }
  if (subqueries.length === 0) {
    return;
  }
  const selectedVarIds: string[] = [];
  for (const item of variables) {
    if ("variable" in item && item.variable && item.variable.value) {
      selectedVarIds.push(item.variable.value);
    }
  }
  const subqueryIds: string[] = [];
  for (const subquery of subqueries) {
    for (const item of subquery.variables) {
      subqueryIds.push(projectionName(item));
    }
  }
  for (const selectedVarId of selectedVarIds) {
    if (subqueryIds.indexOf(selectedVarId) >= 0) {
      throw Error(
        "Target id of 'AS' (?" + selectedVarId +
          ") already used in subquery",
      );
    }
  }
}

/** variableSelectQuery builds a query that selects variables and expressions. */
export function variableSelectQuery(
  select: QueryFragment,
  datasets: DatasetEntry[],
  where: QueryFragment,
  modifiers: QueryFragment,
): QueryFragment {
  const variables = select.variables ?? [];
  // Check for projection of ungrouped variable
  if (!sparqlContext.skipValidation) {
    checkProjection(variables, modifiers.group);
  }
  // Check if id of each AS-selected column is not yet bound by subquery
  checkSubqueryAliases(variables, where.where ?? []);
  return mergeFragments(select, datasetFragment(datasets), where, modifiers);
}

/** constructQuery builds a CONSTRUCT query. */
export function constructQuery(
  template: Triple[] | undefined,
  datasets: DatasetEntry[],
  where: QueryFragment,
  modifiers: QueryFragment,
): QueryFragment {
  const fragment: QueryFragment = { queryType: "CONSTRUCT" };
  fragment.template = template;
  return mergeFragments(
    fragment,
    datasetFragment(datasets),
    where,
    modifiers,
  );
}

/** constructWhereQuery builds the short form `CONSTRUCT WHERE { ... }`. */
export function constructWhereQuery(
  datasets: DatasetEntry[],
  pattern: BgpPattern | undefined,
  modifiers: QueryFragment,
): QueryFragment {
  const template: Triple[] = pattern ? pattern.triples : [];
  const triples: Triple[] = [];
  for (const item of template) triples.push(item);
  return mergeFragments(
    { queryType: "CONSTRUCT", template },
    datasetFragment(datasets),
    { where: [{ type: "bgp", triples }] },
    modifiers,
  );
}

/** describeQuery builds a DESCRIBE query. */
export function describeQuery(
  targets: Term[] | string,
  datasets: DatasetEntry[],
  where: QueryFragment | undefined,
  modifiers: QueryFragment,
): QueryFragment {
  return mergeFragments(
    {
      queryType: "DESCRIBE",
      describe: typeof targets === "string" ? [WILDCARD] : targets,
    },
    datasetFragment(datasets),
    where,
    modifiers,
  );
}

/** askQuery builds an ASK query. */
export function askQuery(
  datasets: DatasetEntry[],
  where: QueryFragment,
  modifiers: QueryFragment,
): QueryFragment {
  return mergeFragments(
    { queryType: "ASK" },
    datasetFragment(datasets),
    where,
    modifiers,
  );
}

/** wildcardSelectQuery builds a `SELECT *` query. */
export function wildcardSelectQuery(
  select: QueryFragment,
  datasets: DatasetEntry[],
  where: QueryFragment,
  modifiers: QueryFragment,
): QueryFragment {
  return mergeFragments(select, datasetFragment(datasets), where, modifiers);
}

/** subSelect builds a subquery. */
export function subSelect(
  select: QueryFragment,
  where: QueryFragment,
  modifiers: QueryFragment,
  values: ValuesPattern | undefined,
): SelectQuery {
  const fragment = mergeFragments(select, where, modifiers);
  return selectQueryOf(fragment, values);
}

function selectQueryOf(
  fragment: QueryFragment,
  values: ValuesPattern | undefined,
): SelectQuery {
  const query: SelectQuery = {
    type: "query",
    queryType: "SELECT",
    variables: fragment.variables ?? [],
  };
  if (fragment.distinct !== undefined) query.distinct = fragment.distinct;
  if (fragment.reduced !== undefined) query.reduced = fragment.reduced;
  if (fragment.from !== undefined) query.from = fragment.from;
  if (fragment.where !== undefined) query.where = fragment.where;
  if (fragment.group !== undefined) query.group = fragment.group;
  if (fragment.having !== undefined) query.having = fragment.having;
  if (fragment.order !== undefined) query.order = fragment.order;
  if (fragment.limit !== undefined) query.limit = fragment.limit;
  if (fragment.offset !== undefined) query.offset = fragment.offset;
  if (values !== undefined) query.values = values.values;
  return query;
}

function constructQueryOf(
  fragment: QueryFragment,
  values: ValuesPattern | undefined,
): ConstructQuery {
  const query: ConstructQuery = {
    type: "query",
    queryType: "CONSTRUCT",
    template: fragment.template,
  };
  if (fragment.from !== undefined) query.from = fragment.from;
  if (fragment.where !== undefined) query.where = fragment.where;
  if (fragment.group !== undefined) query.group = fragment.group;
  if (fragment.having !== undefined) query.having = fragment.having;
  if (fragment.order !== undefined) query.order = fragment.order;
  if (fragment.limit !== undefined) query.limit = fragment.limit;
  if (fragment.offset !== undefined) query.offset = fragment.offset;
  if (values !== undefined) query.values = values.values;
  return query;
}

function describeQueryOf(
  fragment: QueryFragment,
  values: ValuesPattern | undefined,
): DescribeQuery {
  // DESCRIBE targets are variables, IRIs or the wildcard.
  const targets = (fragment.describe ?? []) as DescribeQuery["variables"];
  const query: DescribeQuery = {
    type: "query",
    queryType: "DESCRIBE",
    variables: targets,
  };
  if (fragment.from !== undefined) query.from = fragment.from;
  if (fragment.where !== undefined) query.where = fragment.where;
  if (fragment.group !== undefined) query.group = fragment.group;
  if (fragment.having !== undefined) query.having = fragment.having;
  if (fragment.order !== undefined) query.order = fragment.order;
  if (fragment.limit !== undefined) query.limit = fragment.limit;
  if (fragment.offset !== undefined) query.offset = fragment.offset;
  if (values !== undefined) query.values = values.values;
  return query;
}

function askQueryOf(
  fragment: QueryFragment,
  values: ValuesPattern | undefined,
): AskQuery {
  const query: AskQuery = { type: "query", queryType: "ASK" };
  if (fragment.from !== undefined) query.from = fragment.from;
  if (fragment.where !== undefined) query.where = fragment.where;
  if (fragment.group !== undefined) query.group = fragment.group;
  if (fragment.having !== undefined) query.having = fragment.having;
  if (fragment.order !== undefined) query.order = fragment.order;
  if (fragment.limit !== undefined) query.limit = fragment.limit;
  if (fragment.offset !== undefined) query.offset = fragment.offset;
  if (values !== undefined) query.values = values.values;
  return query;
}

// The prefixes declared so far, as a plain record.
function declaredPrefixRecord(): Record<string, string> {
  const prefixes: Record<string, string> = {};
  for (const [prefix, iri] of sparqlContext.declaredPrefixes) {
    prefixes[prefix] = iri;
  }
  return prefixes;
}

/**
 * queryFromParts finishes a query: attaches its optional trailing VALUES, the
 * base IRI and the declared prefixes.
 */
export function queryFromParts(
  fragment: QueryFragment,
  values: ValuesPattern | undefined,
): Query {
  let query: Query;
  switch (fragment.queryType) {
    case "CONSTRUCT":
      query = constructQueryOf(fragment, values);
      break;
    case "DESCRIBE":
      query = describeQueryOf(fragment, values);
      break;
    case "ASK":
      query = askQueryOf(fragment, values);
      break;
    default:
      query = selectQueryOf(fragment, values);
  }
  if (sparqlContext.base) {
    query.base = sparqlContext.base;
  }
  query.prefixes = declaredPrefixRecord();
  return query;
}

/** whereClause builds `WHERE? { ... }`. */
export function whereClause(group: GroupPattern): QueryFragment {
  return { where: group.patterns };
}

/** solutionModifier merges the GROUP BY clause with the other modifiers. */
export function solutionModifier(
  group: QueryFragment | undefined,
  rest: QueryFragment,
): QueryFragment {
  return mergeFragments(group, rest);
}

/** solutionModifierNoGroup merges the HAVING, ORDER BY and LIMIT clauses. */
export function solutionModifierNoGroup(
  having: QueryFragment | undefined,
  order: QueryFragment | undefined,
  limitOffset: QueryFragment | undefined,
): QueryFragment {
  return mergeFragments(having, order, limitOffset);
}

/** limitOffset builds a LIMIT / OFFSET clause. */
export function limitOffset(
  limit: string | undefined,
  offset: string | undefined,
): QueryFragment {
  const fragment: QueryFragment = {};
  if (limit !== undefined) fragment.limit = toInt(limit);
  if (offset !== undefined) fragment.offset = toInt(offset);
  return fragment;
}

// --- VALUES ---

/** valuesClause builds a VALUES clause. */
export function valuesClause(data: InlineDataValue): ValuesPattern {
  // A nested `VALUES VALUES ...` is accepted by the grammar and wraps the
  // inner clause, as it always has.
  return { type: "values", values: data as ValuePatternRow[] };
}

/** nestedInlineData builds the inline data of a `VALUES DataBlock` alternative. */
export function nestedInlineData(rows: ValuePatternRow[]): ValuesPattern {
  return { type: "values", values: rows };
}

/** valuesForVariable builds the rows of a one-variable data block. */
export function valuesForVariable(
  variableToken: string,
  values: Array<Term | undefined>,
): ValuePatternRow[] {
  const rows: ValuePatternRow[] = [];
  for (const value of values) {
    const row: ValuePatternRow = {};
    row[variableToken] = value;
    rows.push(row);
  }
  return rows;
}

/** emptyValuesRows builds the rows of a `() { () () }` data block. */
export function emptyValuesRows(nils: string[]): ValuePatternRow[] {
  const rows: ValuePatternRow[] = [];
  for (let index = 0; index < nils.length; index++) rows.push({});
  return rows;
}

/** valuesForVariables builds the rows of a multi-variable data block. */
export function valuesForVariables(
  variableTokens: string[],
  valueLists: Array<Array<Term | undefined>>,
): ValuePatternRow[] {
  const length = variableTokens.length;
  const names: string[] = [];
  for (const token of variableTokens) names.push(variableOf(token).value);
  const rows: ValuePatternRow[] = [];
  for (const values of valueLists) {
    if (values.length !== length) {
      throw Error("Inconsistent VALUES length");
    }
    const valuesObject: ValuePatternRow = {};
    for (let index = 0; index < length; index++) {
      valuesObject["?" + names[index]!] = values[index];
    }
    rows.push(valuesObject);
  }
  return rows;
}

/** sparqlStarTerm requires SPARQL-star for a quoted triple used as data. */
export function sparqlStarTerm(quad: QuadTerm): QuadTerm {
  requireSparqlStar();
  return quad;
}

// --- Graph patterns ---

/** groupOf wraps patterns in a group. */
export function groupOf(patterns: Pattern[]): GroupPattern {
  return { type: "group", patterns };
}

/** subSelectGroup wraps a subquery in a group. */
export function subSelectGroup(query: SelectQuery): GroupPattern {
  return { type: "group", patterns: [query] };
}

// Get all bound variable names of a pattern
function getBoundVarsFromGroupGraphPattern(pattern: Pattern): string[] {
  const boundVars: string[] = [];
  if ("triples" in pattern && pattern.triples) {
    for (const t of pattern.triples) {
      if (isVariable(t.subject)) boundVars.push(t.subject.value);
      if ("termType" in t.predicate && isVariable(t.predicate)) {
        boundVars.push(t.predicate.value);
      }
      if (isVariable(t.object)) boundVars.push(t.object.value);
    }
    return boundVars;
  } else if ("patterns" in pattern && pattern.patterns) {
    for (const nested of pattern.patterns) {
      for (const name of getBoundVarsFromGroupGraphPattern(nested)) {
        boundVars.push(name);
      }
    }
    return boundVars;
  }
  return boundVars;
}

function isVariable(term: Term): boolean {
  return term.termType === "Variable";
}

/** groupGraphPattern builds `{ patterns }`, checking BIND variable scoping. */
export function groupGraphPattern(patterns: Pattern[]): GroupPattern {
  // For every binding
  for (let index = 0; index < patterns.length; index++) {
    const binding = patterns[index]!;
    if (binding.type !== "bind") continue;
    const bindingIndex = patterns.indexOf(binding);
    const boundVars = new Set<string>();
    // Collect all bounded variables before the binding
    for (let before = 0; before < bindingIndex; before++) {
      const element = patterns[before]!;
      if (element.type === "group" || element.type === "bgp") {
        for (const name of getBoundVarsFromGroupGraphPattern(element)) {
          boundVars.add(name);
        }
      }
    }
    // If binding with a non-free variable, throw error
    if (boundVars.has(binding.variable.value)) {
      throw Error(
        "Variable used to bind is already bound (?" + binding.variable.value +
          ")",
      );
    }
  }
  return { type: "group", patterns };
}

/** groupGraphPatternSub joins a leading BGP with the patterns that follow. */
export function groupGraphPatternSub(
  leading: BgpPattern | undefined,
  tails: Pattern[][],
): Pattern[] {
  const patterns: Pattern[] = [];
  if (leading !== undefined) patterns.push(leading);
  for (const tail of tails) {
    for (const pattern of tail) patterns.push(pattern);
  }
  return patterns;
}

/** patternWithTriples pairs a pattern with the BGP that follows it. */
export function patternWithTriples(
  pattern: Pattern,
  triples: BgpPattern | undefined,
): Pattern[] {
  return triples === undefined ? [pattern] : [pattern, triples];
}

/** unionOrGroup builds `{ } UNION { } ...`, or the single group. */
export function unionOrGroup(
  leading: GroupPattern[],
  last: GroupPattern,
): Pattern {
  if (leading.length === 0) {
    return last;
  }
  const patterns: Pattern[] = [];
  for (const group of leading) patterns.push(degroupSingle(group));
  patterns.push(degroupSingle(last));
  const union: UnionPattern = { type: "union", patterns };
  return union;
}

/** optionalPattern builds `OPTIONAL { ... }`. */
export function optionalPattern(group: GroupPattern): OptionalPattern {
  return { type: "optional", patterns: group.patterns };
}

/** minusPattern builds `MINUS { ... }`. */
export function minusPattern(group: GroupPattern): MinusPattern {
  return { type: "minus", patterns: group.patterns };
}

/** graphPattern builds `GRAPH name { ... }`. */
export function graphPattern(name: Term, group: GroupPattern): GraphPattern {
  return { type: "graph", patterns: group.patterns, name };
}

/** servicePattern builds `SERVICE [SILENT] name { ... }`. */
export function servicePattern(
  silent: string | undefined,
  name: Term,
  group: GroupPattern,
): ServicePattern {
  return {
    type: "service",
    patterns: group.patterns,
    name,
    silent: present(silent),
  };
}

/** filterPattern builds `FILTER constraint`. */
export function filterPattern(expression: Expression): FilterPattern {
  return { type: "filter", expression };
}

/** bindPattern builds `BIND(expression AS ?var)`. */
export function bindPattern(
  expression: Expression,
  variable: VariableTerm,
): BindPattern {
  return { type: "bind", variable, expression };
}

// --- Updates ---

/** loadOperation builds `LOAD [SILENT] <iri> [INTO GRAPH <iri>]`. */
export function loadOperation(
  silent: string | undefined,
  source: Term,
  destination: Term | undefined,
): LoadOperation {
  const operation: LoadOperation = {
    type: "load",
    silent: present(silent),
    source,
  };
  if (destination) operation.destination = destination;
  return operation;
}

/** clearOrDropOperation builds `CLEAR|DROP [SILENT] target`. */
export function clearOrDropOperation(
  kind: string,
  silent: string | undefined,
  graph: GraphReference,
): ClearDropOperation {
  return {
    type: lowercase(kind) === "clear" ? "clear" : "drop",
    silent: present(silent),
    graph: graph as ClearDropOperation["graph"],
  };
}

/** copyMoveOperation builds `ADD|MOVE|COPY [SILENT] source TO destination`. */
export function copyMoveOperation(
  kind: string,
  silent: string | undefined,
  source: GraphOrDefaultValue,
  destination: GraphOrDefaultValue,
): CopyMoveOperation {
  const lowered = lowercase(kind);
  return {
    type: lowered === "add" ? "add" : lowered === "move" ? "move" : "copy",
    silent: present(silent),
    source: source as CopyMoveOperation["source"],
    destination: destination as CopyMoveOperation["destination"],
  };
}

/** createOperation builds `CREATE [SILENT] GRAPH <iri>`. */
export function createOperation(
  silent: string | undefined,
  name: Term,
): CreateOperation {
  return {
    type: "create",
    silent: present(silent),
    graph: { type: "graph", name },
  };
}

function checkNoVariables(operations: QuadBlock[]): QuadBlock[] {
  for (const block of operations) {
    if (block.type === "graph" && block.name.termType === "Variable") {
      throw new Error("Detected illegal variable in GRAPH");
    }
    for (const t of block.triples) {
      if (
        t.subject.termType === "Variable" ||
        termTypeOf(t.predicate) === "Variable" ||
        t.object.termType === "Variable"
      ) {
        throw new Error("Detected illegal variable in BGP");
      }
    }
  }
  return operations;
}

function termTypeOf(term: Term | PropertyPath): string | undefined {
  return "termType" in term ? term.termType : undefined;
}

function checkNoBlankNodes(operations: QuadBlock[]): QuadBlock[] {
  for (const block of operations) {
    if (block.type === "bgp") {
      for (const t of block.triples) {
        if (
          t.subject.termType === "BlankNode" ||
          termTypeOf(t.predicate) === "BlankNode" ||
          t.object.termType === "BlankNode"
        ) {
          throw new Error("Detected illegal blank node in BGP");
        }
      }
    }
  }
  return operations;
}

/** insertDataOperation builds `INSERT DATA { ... }`. */
export function insertDataOperation(quads: QuadBlock[]): InsertDeleteOperation {
  return {
    updateType: "insert",
    insert: checkNoVariables(quads) as Pattern[],
  };
}

/** deleteDataOperation builds `DELETE DATA { ... }`. */
export function deleteDataOperation(quads: QuadBlock[]): InsertDeleteOperation {
  return {
    updateType: "delete",
    delete: checkNoBlankNodes(checkNoVariables(quads)) as Pattern[],
  };
}

/** deleteWhereOperation builds `DELETE WHERE { ... }`. */
export function deleteWhereOperation(
  quads: QuadBlock[],
): InsertDeleteOperation {
  return {
    updateType: "deletewhere",
    delete: checkNoBlankNodes(quads) as Pattern[],
  };
}

/** modifyOperation builds `[WITH g] DELETE/INSERT ... USING ... WHERE { ... }`. */
export function modifyOperation(
  withClause: WithValue | undefined,
  parts: InsertDeleteParts,
  using: DatasetEntry[],
  where: GroupPattern,
): InsertDeleteOperation {
  const operation: InsertDeleteOperation = { updateType: "insertdelete" };
  if (withClause !== undefined) operation.graph = withClause.graph;
  operation.delete = parts.delete as Pattern[];
  operation.insert = parts.insert as Pattern[];
  const grouped = groupDatasets(using);
  if (grouped !== undefined) operation.using = grouped;
  operation.where = where.patterns;
  return operation;
}

/** deleteInsertParts builds `DELETE { } [INSERT { }]`. */
export function deleteInsertParts(
  deleted: QuadBlock[],
  inserted: QuadBlock[] | undefined,
): InsertDeleteParts {
  return {
    delete: checkNoBlankNodes(deleted),
    insert: inserted || [],
  };
}

/** insertOnlyParts builds a lone `INSERT { }`. */
export function insertOnlyParts(inserted: QuadBlock[]): InsertDeleteParts {
  return { delete: [], insert: inserted };
}

/** updateRequest builds a sequence of update operations. */
export function updateRequest(
  leading: UpdateOperation[],
  last: UpdateOperation,
): UpdateQuery {
  leading.push(last);
  const update: UpdateQuery = { type: "update", updates: leading };
  if (sparqlContext.base) {
    update.base = sparqlContext.base;
  }
  update.prefixes = declaredPrefixRecord();
  return update;
}

/** graphOrDefaultDefault builds the `DEFAULT` target. */
export function graphOrDefaultDefault(): GraphOrDefaultValue {
  return { type: "graph", default: true };
}

/** graphOrDefaultNamed builds the `[GRAPH] <iri>` target. */
export function graphOrDefaultNamed(name: Term): GraphOrDefaultValue {
  return { type: "graph", name };
}

/** graphReferenceNamed builds `GRAPH <iri>` as a clear / drop target. */
export function graphReferenceNamed(name: Term): GraphReference {
  return { type: "graph", name };
}

/** graphReferenceKeyword builds the `DEFAULT` / `NAMED` / `ALL` target. */
export function graphReferenceKeyword(keyword: string): GraphReference {
  const lowered = lowercase(keyword);
  if (lowered === "default") return { default: true };
  if (lowered === "named") return { named: true };
  return { all: true };
}

/** withClause builds `WITH <iri>`. */
export function withClause(graph: Term): WithValue {
  return { graph };
}

/** quadsOf joins a leading triples template with its graph blocks. */
export function quadsOf(
  leading: BgpPattern | undefined,
  graphs: QuadBlock[][],
): QuadBlock[] {
  const quads: QuadBlock[] = [];
  for (const blocks of graphs) {
    for (const block of blocks) quads.push(block);
  }
  if (leading !== undefined) quads.push(leading);
  return quads;
}

/** quadsGraphBlock builds `GRAPH g { ... } [.] [triples]`. */
export function quadsGraphBlock(
  name: Term,
  inner: BgpPattern | undefined,
  trailing: BgpPattern | undefined,
): QuadBlock[] {
  const graph: QuadsGraph = {
    type: "graph",
    triples: inner ? inner.triples : [],
    name,
  };
  return trailing ? [graph, trailing] : [graph];
}

// --- The entry rule ---

/** ParsedStatement is what the entry rule's alternatives produce. */
export type ParsedStatement =
  | Query
  | UpdateQuery
  | PropertyPath
  | NamedNodeTerm
  | undefined;

// Throws when an INSERT DATA clause reuses a blank node of an earlier one.
function checkInsertDataBlankNodes(update: UpdateQuery): undefined {
  const insertBnodesAll = new Set<string>();
  for (const operation of update.updates) {
    if (operation.updateType === "insert") {
      // Collect bnodes for current insert clause
      const insertBnodes = new Set<string>();
      for (const block of operation.insert ?? []) {
        if (block.type === "bgp" || block.type === "graph") {
          for (const t of block.triples ?? []) {
            if (t.subject.termType === "BlankNode") {
              insertBnodes.add(t.subject.value);
            }
            if (termTypeOf(t.predicate) === "BlankNode") {
              insertBnodes.add((t.predicate as Term).value);
            }
            if (t.object.termType === "BlankNode") {
              insertBnodes.add(t.object.value);
            }
          }
        }
      }

      // Check if the inserting bnodes don't clash with bnodes from a
      // previous insert clause
      for (const bnode of insertBnodes) {
        if (insertBnodesAll.has(bnode)) {
          throw new Error(
            "Detected reuse blank node across different INSERT DATA clauses",
          );
        }
        insertBnodesAll.add(bnode);
      }
    }
  }
}

/**
 * finishParse finishes the entry rule: validates the result against the parse
 * mode and checks that blank nodes are not shared across INSERT DATA clauses.
 * The result is left in the context.
 */
export function finishParse(parsed: ParsedStatement): SparqlResult {
  if (parsed === undefined) {
    // Only directives (or nothing) were given: there is nothing to run.
    sparqlContext.base = "";
    if (sparqlContext.pathOnly) {
      throw new Error("Received full SPARQL query in path only mode");
    }
    throw new Error("Expected a SPARQL query or update");
  }
  sparqlContext.base = "";
  if ("termType" in parsed || parsed.type === "path") {
    // Path or term results are only legal in path-only mode.
    if (sparqlContext.pathOnly) {
      sparqlContext.result = parsed;
      return parsed;
    }
    throw new Error("Received only path in full SPARQL mode");
  }
  if (sparqlContext.pathOnly) {
    throw new Error("Received full SPARQL query in path only mode");
  }
  if (parsed.type === "update") {
    checkInsertDataBlankNodes(parsed);
  }
  sparqlContext.result = parsed;
  return parsed;
}

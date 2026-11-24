import { Parser, SparqlSyntaxError } from "./mod.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { thrown } from "../../test/thrown.ts";
import { parseExpression } from "@/parser/mod-test-helpers.ts";
import { toSparqlSyntaxError } from "./syntax-error.ts";
import { LrParseError } from "./lr-runtime.ts";

test("parser: malformed numeric literal reports line and column", () => {
  const error = thrown(
    () => new Parser().parse("SELECT 1.2.3 WHERE {}"),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.kind, "parse");
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, 8);
  assert.deepStrictEqual(error.token, "DECIMAL");
  assert.deepStrictEqual(error.excerpt, "SELECT 1.2.3 WHERE {}");
  assert.deepStrictEqual(error.expected.slice(0, 2), ["'*'", "'('"]);
  assert.deepStrictEqual(
    error.message,
    "Syntax error at line 1, column 8: unexpected 'DECIMAL'; expecting " +
      "'*', '(', 'VAR', 'DISTINCT', 'REDUCED'\n\n" +
      "SELECT 1.2.3 WHERE {}\n       ^",
  );
});

test("parser: unclosed group reports the end-of-input column", () => {
  const query = "SELECT ?s WHERE { ?s <http://example.org/p> ?o ";
  const error = thrown(
    () => new Parser().parse(query),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, query.length + 1);
  assert.deepStrictEqual(error.token, "EOF");
  assert.deepStrictEqual(error.excerpt, query);
  assert.deepStrictEqual(error.expected.length > 0, true);
});

test("parser: bad prefix reports the offending token", () => {
  const error = thrown(
    () =>
      new Parser().parse(
        "PREFIX x: <http://example.org/ SELECT ?s WHERE {}",
      ),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, 11);
  assert.deepStrictEqual(error.token, "<");
  assert.deepStrictEqual(error.expected, ["'IRIREF'"]);
});

test("parser: stray closing brace reports the trailing token", () => {
  const error = thrown(
    () =>
      new Parser().parse(
        "SELECT ?s WHERE { ?s <http://example.org/p> ?o } }",
      ),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, 50);
  assert.deepStrictEqual(error.token, "}");
  assert.deepStrictEqual(error.expected, ["'EOF'", "'VALUES'"]);
});

test("parser: multi-line queries report positions on the right line", () => {
  const error = thrown(
    () =>
      new Parser().parse(
        "SELECT ?s WHERE {\n  ?s <http://example.org/p> ?o .\n  BADTOKEN\n}",
      ),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 3);
  assert.deepStrictEqual(error.column, 3);
  assert.deepStrictEqual(error.excerpt, "  BADTOKEN");
  assert.deepStrictEqual(error.token, "INVALID");
});

test("parser: malformed update requests report positions", () => {
  const error = thrown(
    () =>
      new Parser().parse(
        "INSERT DATA { <http://example.org/s> <http://example.org/p> }",
      ),
    SparqlSyntaxError,
  );
  assert.deepStrictEqual(error.line, 1);
  assert.deepStrictEqual(error.column, 61);
  assert.deepStrictEqual(error.token, "}");
  assert.deepStrictEqual(error.expected.includes("'EOF'"), true);
});

test("parser: lexical failures map to kind 'lexical'", () => {
  const error = toSparqlSyntaxError(
    "SELECT ?s\n  BAD\n",
    new LrParseError(
      "Lexical error on line 3. Unrecognized text.\n  BAD\n  ^",
      { text: "", token: null, line: 2, loc: null, expected: [] },
    ),
  );
  assert.deepStrictEqual(error?.kind, "lexical");
  assert.deepStrictEqual(error?.line, 3);
  assert.deepStrictEqual(error?.token, null);
  assert.deepStrictEqual(error?.expected, []);
  assert.deepStrictEqual(
    error?.message.startsWith("Syntax error at line 3"),
    true,
  );
});

test("parser: non-syntax errors pass through unchanged", () => {
  const error = thrown(
    () => new Parser().parse("SELECT ?s WHERE { ?s <p> ?o }"),
  );
  assert.deepStrictEqual(error instanceof SparqlSyntaxError, false);
});

test("parser: LANGDIR parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello") AS ?x) }',
  );
  assert.deepStrictEqual(name, "langdir");
  assert.deepStrictEqual(args.length, 1);
});

test("parser: LANGDIR accepts a lang-tagged literal", () => {
  const { name } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello"@en) AS ?x) }',
  );
  assert.deepStrictEqual(name, "langdir");
});

test("parser: hasLang parses as a unary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en) AS ?x) }',
  );
  assert.deepStrictEqual(name, "haslang");
  assert.deepStrictEqual(args.length, 1);
});

test("parser: hasLang parses as a binary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en, "en") AS ?x) }',
  );
  assert.deepStrictEqual(name, "haslang");
  assert.deepStrictEqual(args.length, 2);
});

test("parser: hasLang parses as a ternary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en--ltr, "en", "ltr") AS ?x) }',
  );
  assert.deepStrictEqual(name, "haslang");
  assert.deepStrictEqual(args.length, 3);
});

test("parser: hasLang works in FILTER", () => {
  const ast = new Parser().parse(
    "SELECT ?x WHERE { ?s ?p ?x FILTER(hasLang(?x)) }",
  );
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<
    { type: string; expression?: { operator: string } }
  >;
  const filter = where.find((w) => w.type === "filter");
  assert.deepStrictEqual(filter?.expression?.operator, "haslang");
});

test("parser: STRLANGDIR parses as a ternary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(STRLANGDIR("hello", "en", "ltr") AS ?x) }',
  );
  assert.deepStrictEqual(name, "strlangdir");
  assert.deepStrictEqual(args.length, 3);
});

test("parser: hasLangDir parses as a unary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLangDir("hello"@en--ltr) AS ?x) }',
  );
  assert.deepStrictEqual(name, "haslangdir");
  assert.deepStrictEqual(args.length, 1);
});

test("parser: prefix conflicts still lex correctly", () => {
  // LANGDIR/LANG, STRLANGDIR/STRLANG, hasLangDir/hasLang must not shadow each other.
  const names = [
    'LANG("hello"@en)',
    'STRLANG("abc", "en")',
    'LANGMATCHES("en", "en")',
    'STR("abc")',
  ].map((expr) =>
    parseExpression(`SELECT ?x WHERE { BIND(${expr} AS ?x) }`).name
  );
  assert.deepStrictEqual(names, ["lang", "strlang", "langmatches", "str"]);
});

test("parser: recursive unary ! allows double negation", () => {
  // SPARQL 1.2 grammar [135] makes '!' recursive: `!!x` == !(!x).
  const ast = new Parser().parse(
    "SELECT ?v WHERE { VALUES ?v { true false } BIND(!!?v AS ?ebv) }",
  );
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<
    { type: string; expression?: { operator: string; args: unknown[] } }
  >;
  const bind = where.find((w) => w.type === "bind");
  assert.deepStrictEqual(bind?.expression?.operator, "!");
  assert.deepStrictEqual(
    (bind?.expression?.args[0] as { operator?: string })?.operator,
    "!",
  );
});

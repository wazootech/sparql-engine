import { assertEquals, assertThrows } from "@std/assert";

import { Parser } from "./mod.ts";

function parseExpression(query: string): {
  name: string;
  args: unknown[];
} {
  const ast = new Parser({ sparqlStar: true }).parse(query);
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<{
    type: string;
    expression?: { type: string; operator: string; args: unknown[] };
  }>;
  const bind = where.find((w) => w.type === "bind");
  if (!bind?.expression) {
    throw new Error(`no BIND expression found in ${query}`);
  }
  return { name: bind.expression.operator, args: bind.expression.args };
}

Deno.test("vendored parser: LANGDIR parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello") AS ?x) }',
  );
  assertEquals(name, "langdir");
  assertEquals(args.length, 1);
});

Deno.test("vendored parser: LANGDIR accepts a lang-tagged literal", () => {
  const { name } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello"@en) AS ?x) }',
  );
  assertEquals(name, "langdir");
});

Deno.test("vendored parser: hasLang parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello", "en") AS ?x) }',
  );
  assertEquals(name, "haslang");
  assertEquals(args.length, 2);
});

Deno.test("vendored parser: hasLang works in FILTER", () => {
  const ast = new Parser().parse(
    'SELECT ?x WHERE { ?s ?p ?x FILTER(hasLang(?x, "en")) }',
  );
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<
    { type: string; expression?: { operator: string } }
  >;
  const filter = where.find((w) => w.type === "filter");
  assertEquals(filter?.expression?.operator, "haslang");
});

Deno.test("vendored parser: STRLANGDIR parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(STRLANGDIR("hello", "en") AS ?x) }',
  );
  assertEquals(name, "strlangdir");
  assertEquals(args.length, 2);
});

Deno.test("vendored parser: hasLangDir parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLangDir("hello", "en", "ltr") AS ?x) }',
  );
  assertEquals(name, "haslangdir");
  assertEquals(args.length, 3);
});

Deno.test("vendored parser: prefix conflicts still lex correctly", () => {
  // LANGDIR/LANG, STRLANGDIR/STRLANG, hasLangDir/hasLang must not shadow each other.
  const names = [
    'LANG("hello"@en)',
    'STRLANG("abc", "en")',
    'LANGMATCHES("en", "en")',
    'STR("abc")',
  ].map((expr) =>
    parseExpression(`SELECT ?x WHERE { BIND(${expr} AS ?x) }`).name
  );
  assertEquals(names, ["lang", "strlang", "langmatches", "str"]);
});

Deno.test("vendored parser: unknown bare function names still rejected", () => {
  assertThrows(() =>
    new Parser().parse('SELECT ?x WHERE { BIND(foo("hello") AS ?x) }')
  );
});

Deno.test("vendored parser: AST is a drop-in for upstream sparqljs", () => {
  const ast = new Parser().parse(
    "PREFIX ex: <http://ex/> SELECT ?s ?o WHERE { ?s ex:p ?o } ORDER BY ?o LIMIT 3",
  );
  assertEquals(ast.type, "query");
  if (ast.type !== "query") throw new Error("expected a query");
  assertEquals(ast.queryType, "SELECT");
  const where = ast.where as Array<{ type: string; triples: unknown[] }>;
  assertEquals(where[0].type, "bgp");
  assertEquals(where[0].triples.length, 1);
});

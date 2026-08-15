import { assertEquals, assertThrows } from "@std/assert";

import { Parser, SparqlSyntaxError } from "./mod.ts";
import { toSparqlSyntaxError } from "./syntax-error.ts";

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

Deno.test("parser: malformed numeric literal reports line and column", () => {
  const error = assertThrows(
    () => new Parser().parse("SELECT 1.2.3 WHERE {}"),
    SparqlSyntaxError,
  );
  assertEquals(error.kind, "parse");
  assertEquals(error.line, 1);
  assertEquals(error.column, 8);
  assertEquals(error.token, "DECIMAL");
  assertEquals(error.excerpt, "SELECT 1.2.3 WHERE {}");
  assertEquals(error.expected.slice(0, 2), ["'*'", "'('"]);
  assertEquals(
    error.message,
    "Syntax error at line 1, column 8: unexpected 'DECIMAL'; expecting " +
      "'*', '(', 'VAR', 'DISTINCT', 'REDUCED'\n\n" +
      "SELECT 1.2.3 WHERE {}\n       ^",
  );
});

Deno.test("parser: unclosed group reports the end-of-input column", () => {
  const query = "SELECT ?s WHERE { ?s <http://example.org/p> ?o ";
  const error = assertThrows(
    () => new Parser().parse(query),
    SparqlSyntaxError,
  );
  assertEquals(error.line, 1);
  assertEquals(error.column, query.length + 1);
  assertEquals(error.token, "EOF");
  assertEquals(error.excerpt, query);
  assertEquals(error.expected.length > 0, true);
});

Deno.test("parser: bad prefix reports the offending token", () => {
  const error = assertThrows(
    () =>
      new Parser().parse(
        "PREFIX x: <http://example.org/ SELECT ?s WHERE {}",
      ),
    SparqlSyntaxError,
  );
  assertEquals(error.line, 1);
  assertEquals(error.column, 11);
  assertEquals(error.token, "<");
  assertEquals(error.expected, ["'IRIREF'"]);
});

Deno.test("parser: stray closing brace reports the trailing token", () => {
  const error = assertThrows(
    () =>
      new Parser().parse(
        "SELECT ?s WHERE { ?s <http://example.org/p> ?o } }",
      ),
    SparqlSyntaxError,
  );
  assertEquals(error.line, 1);
  assertEquals(error.column, 50);
  assertEquals(error.token, "}");
  assertEquals(error.expected, ["'EOF'", "'VALUES'"]);
});

Deno.test("parser: multi-line queries report positions on the right line", () => {
  const error = assertThrows(
    () =>
      new Parser().parse(
        "SELECT ?s WHERE {\n  ?s <http://example.org/p> ?o .\n  BADTOKEN\n}",
      ),
    SparqlSyntaxError,
  );
  assertEquals(error.line, 3);
  assertEquals(error.column, 3);
  assertEquals(error.excerpt, "  BADTOKEN");
  assertEquals(error.token, "INVALID");
});

Deno.test("parser: malformed update requests report positions", () => {
  const error = assertThrows(
    () =>
      new Parser().parse(
        "INSERT DATA { <http://example.org/s> <http://example.org/p> }",
      ),
    SparqlSyntaxError,
  );
  assertEquals(error.line, 1);
  assertEquals(error.column, 61);
  assertEquals(error.token, "}");
  assertEquals(error.expected.includes("'EOF'"), true);
});

Deno.test("parser: lexical failures map to kind 'lexical'", () => {
  const error = toSparqlSyntaxError(
    "SELECT ?s\n  BAD\n",
    Object.assign(
      new Error(
        "Lexical error on line 3. Unrecognized text.\n  BAD\n  ^",
      ),
      { hash: { text: "", token: null, line: 2 } },
    ),
  );
  assertEquals(error?.kind, "lexical");
  assertEquals(error?.line, 3);
  assertEquals(error?.token, null);
  assertEquals(error?.expected, []);
  assertEquals(error?.message.startsWith("Syntax error at line 3"), true);
});

Deno.test("parser: non-syntax errors pass through unchanged", () => {
  const error = assertThrows(
    () => new Parser().parse("SELECT ?s WHERE { ?s <p> ?o }"),
  );
  assertEquals(error instanceof SparqlSyntaxError, false);
});

Deno.test("parser: LANGDIR parses as a functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello") AS ?x) }',
  );
  assertEquals(name, "langdir");
  assertEquals(args.length, 1);
});

Deno.test("parser: LANGDIR accepts a lang-tagged literal", () => {
  const { name } = parseExpression(
    'SELECT ?x WHERE { BIND(LANGDIR("hello"@en) AS ?x) }',
  );
  assertEquals(name, "langdir");
});

Deno.test("parser: hasLang parses as a unary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en) AS ?x) }',
  );
  assertEquals(name, "haslang");
  assertEquals(args.length, 1);
});

Deno.test("parser: hasLang parses as a binary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en, "en") AS ?x) }',
  );
  assertEquals(name, "haslang");
  assertEquals(args.length, 2);
});

Deno.test("parser: hasLang parses as a ternary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLang("hello"@en--ltr, "en", "ltr") AS ?x) }',
  );
  assertEquals(name, "haslang");
  assertEquals(args.length, 3);
});

Deno.test("parser: hasLang works in FILTER", () => {
  const ast = new Parser().parse(
    "SELECT ?x WHERE { ?s ?p ?x FILTER(hasLang(?x)) }",
  );
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<
    { type: string; expression?: { operator: string } }
  >;
  const filter = where.find((w) => w.type === "filter");
  assertEquals(filter?.expression?.operator, "haslang");
});

Deno.test("parser: STRLANGDIR parses as a ternary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(STRLANGDIR("hello", "en", "ltr") AS ?x) }',
  );
  assertEquals(name, "strlangdir");
  assertEquals(args.length, 3);
});

Deno.test("parser: hasLangDir parses as a unary functionCall", () => {
  const { name, args } = parseExpression(
    'SELECT ?x WHERE { BIND(hasLangDir("hello"@en--ltr) AS ?x) }',
  );
  assertEquals(name, "haslangdir");
  assertEquals(args.length, 1);
});

Deno.test("parser: prefix conflicts still lex correctly", () => {
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

Deno.test("parser: recursive unary ! allows double negation", () => {
  // SPARQL 1.2 grammar [135] makes '!' recursive: `!!x` == !(!x).
  const ast = new Parser().parse(
    "SELECT ?v WHERE { VALUES ?v { true false } BIND(!!?v AS ?ebv) }",
  );
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<
    { type: string; expression?: { operator: string; args: unknown[] } }
  >;
  const bind = where.find((w) => w.type === "bind");
  assertEquals(bind?.expression?.operator, "!");
  assertEquals(
    (bind?.expression?.args[0] as { operator?: string })?.operator,
    "!",
  );
});

Deno.test("parser: unknown bare function names still rejected", () => {
  assertThrows(() =>
    new Parser().parse('SELECT ?x WHERE { BIND(foo("hello") AS ?x) }')
  );
});

Deno.test("parser: AST is a drop-in for upstream sparqljs", () => {
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

function parseBgpTriples(query: string): Array<{
  subject: { value?: string; termType?: string };
  predicate: { value?: string; termType?: string };
  object: { value?: string; termType?: string };
}> {
  const ast = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(query);
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<{ type: string; triples: unknown[] }>;
  const bgp = where.find((w) => w.type === "bgp");
  if (!bgp) throw new Error(`no BGP found in ${query}`);
  return bgp.triples as never;
}

Deno.test("parser: reifier and annotation after an object expand to reifies + annotation triples", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o ~ :iri {| :r ?Z |} . }",
  );
  assertEquals(triples.length, 3);
  const [base, reifies, ann] = triples;
  assertEquals(base.subject.value, "s");
  assertEquals(base.object.value, "o");
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
  assertEquals(reifies.object.termType, "Quad");
  assertEquals(ann.subject.value, "http://example.com/ns#iri");
  assertEquals(ann.predicate.value, "http://example.com/ns#r");
  assertEquals(ann.object.value, "Z");
});

Deno.test("parser: reifier-only object (no annotation block)", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o ~ :iri . }",
  );
  assertEquals(triples.length, 2);
  const [, reifies] = triples;
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(
    reifies.predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

Deno.test("parser: bare ~ and variable reifier bind via rdf:reifies", () => {
  const bare = parseBgpTriples("SELECT * { ?s ?p ?o ~ . }");
  // The quad stands in for the reifier; the evaluator mints a fresh one.
  assertEquals(bare[1].subject.termType, "Quad");
  assertEquals(
    bare[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );

  const variable = parseBgpTriples("SELECT * { ?s ?p ?o ~ ?r . }");
  assertEquals(variable[1].subject.value, "r");
  assertEquals(
    variable[1].predicate.value,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies",
  );
});

Deno.test("parser: annotation block and reifier combine in either order", () => {
  const triples = parseBgpTriples(
    "SELECT * { ?s ?p ?o {| :a :b |} ~ :iri {| :c :d |} . }",
  );
  // base + reifies + annotation :a :b + annotation :c :d
  assertEquals(triples.length, 4);
  const [, reifies, annA, annC] = triples;
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(annA.subject.value, "http://example.com/ns#iri");
  assertEquals(annA.predicate.value, "http://example.com/ns#a");
  assertEquals(annC.predicate.value, "http://example.com/ns#c");
});

Deno.test("parser: reifier after a quoted-triple object", () => {
  const triples = parseBgpTriples(
    "SELECT * { :s :p <<:a :b :c>> ~ :iri {| ?q ?z |} }",
  );
  assertEquals(triples.length, 3);
  const [base, reifies, ann] = triples;
  assertEquals(base.object.termType, "Quad");
  assertEquals(reifies.subject.value, "http://example.com/ns#iri");
  assertEquals(ann.subject.value, "http://example.com/ns#iri");
});

Deno.test("parser: subject-position annotation blocks are rejected per the SPARQL 1.2 grammar", () => {
  // Annotations attach to objects (Object ::= GraphNode Annotation); a quoted
  // triple subject takes a plain property list (ReifiedTripleBlock).
  assertThrows(() =>
    new Parser({ sparqlStar: true, prefixes: { "": "http://example.com/ns#" } })
      .parse(
        "SELECT * { << :s :p :o >> {| :a :b |} }",
      )
  );
  new Parser({ sparqlStar: true, prefixes: { "": "http://example.com/ns#" } })
    .parse(
      "SELECT * { << :s :p :o >> :p2 :o2 }",
    );
});

Deno.test("parser: CONSTRUCT and INSERT templates accept reifiers", () => {
  const construct = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(
    "CONSTRUCT { ?s ?p ?o ~ :iri {| :source ?g |} } WHERE { ?s ?p ?o }",
  );
  assertEquals(construct.type, "query");
  const insert = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(
    "INSERT DATA { :s :p :o ~ :iri {| :a :b |} }",
  );
  assertEquals(insert.type, "update");
});

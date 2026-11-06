import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildPeopleTurtle } from "../../bench/cli-workloads.ts";
import { LR_EOF, LrLexer } from "@/parser/lr-runtime.ts";
import { buildLexerDispatch } from "@/parser/lexer-dispatch.ts";

/** RuleLexer reports the matched rule index as the token id, ignoring nothing. */
class RuleLexer extends LrLexer {
  override performAction(rule: number): number {
    return rule + 1;
  }
}

/** loadRules reads a generated parser's LEXER_RULES array literal. */
function loadRules(path: string): RegExp[] {
  const source = Deno.readTextFileSync(path);
  const start = source.indexOf("const LEXER_RULES: RegExp[] = [");
  const end = source.indexOf("\n];", start);
  assert(start >= 0 && end > start, `no LEXER_RULES in ${path}`);
  const literal = source.slice(source.indexOf("[", start), end + 2);
  return new Function(`return ${literal};`)() as RegExp[];
}

/** tokenize lists every token (rule, text, location) or the lexical error. */
function tokenize(
  input: string,
  rules: RegExp[],
  exhaustive: boolean,
): string[] {
  const lexer = new RuleLexer(input, rules, exhaustive);
  const tokens: string[] = [];
  try {
    for (;;) {
      const token = lexer.next();
      const location = lexer.yylloc;
      tokens.push(
        `${token}|${lexer.yytext}|${lexer.yylineno}|${location.firstLine}:` +
          `${location.firstColumn}-${location.lastLine}:${location.lastColumn}`,
      );
      if (token === LR_EOF) {
        break;
      }
    }
  } catch (error) {
    tokens.push("error: " + (error as Error).message);
  }
  return tokens;
}

function assertEquivalent(name: string, input: string, rules: RegExp[]): void {
  assertEquals(
    tokenize(input, rules, false),
    tokenize(input, rules, true),
    name,
  );
}

function filesWithExtensions(root: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of Deno.readDirSync(root)) {
    const path = join(root, entry.name);
    if (entry.isDirectory) {
      found.push(...filesWithExtensions(path, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

const turtleRules = loadRules("src/parser/turtle-generated.ts");
const sparqlRules = loadRules("src/parser/parser.ts");

const TURTLE_SNIPPETS = [
  `@prefix ex: <http://example.org/> .\nPREFIX p: <urn:x#>\nBASE <http://b/>\n`,
  `ex:a ex:b "esc \\"q\\" \n \u00E9" , 'single', """long\n"quoted" """, '''x''' .`,
  `ex:a ex:b "chat"@fr-CA, "a"@en--ltr ; ex:n 1, -2, +3.5, .5, 1e10, 2.5E-3 .`,
  `_:b0 ex:p [ ex:q ( 1 2 "three" ) ] , [] , _:b1 . # trailing comment`,
  `<<( ex:s ex:p ex:o )>> ex:q << ex:s ex:p ex:o ~ ex:r >> {| ex:z 1 |} .`,
  `ex:a a ex:C ; ex:b true , false . GRAPH ex:g { ex:s ex:p ex:o }`,
  `ex:caf\u00E9 ex:p "\u00E9\u4E2D\uD83D\uDE00" . <http://a/\u00E9> ex:p ex:q`,
  `ex:a ex:b "unterminated`,
  `ex:a ex:b \u0001 .`,
  `\r\n\t  \n# only comment`,
  ``,
  `   `,
  `\u00A0 ex:a`,
];

const SPARQL_SNIPPETS = [
  `PREFIX ex: <http://e/> SELECT DISTINCT ?x (COUNT(*) AS ?n) WHERE { ?x ex:p ?o FILTER(LANGDIR(?o) = "ltr" && regex(?o, "a", "i")) } GROUP BY ?x ORDER BY DESC(?n) LIMIT 5`,
  `select * where { <a> a/b* ?x . optional { ?x !(<p>|^<q>) "\u00E9"@en } values ?z { 1 2.5 1e3 UNDEF } }`,
  `INSERT DATA { GRAPH <g> { <a> <b> 'c' . _:x <p> """l\nong""" } } ; DROP ALL`,
  `SELECT ?s WHERE { ?s <p> << ?a ?b ?c ~ ?r >> . BIND(<<( <a> <b> <c> )>> AS ?t) } # c`,
  `SELECT ?\u00E9 WHERE { ?\u00E9 ?p ?o } hasLang STRLANGDIR`,
  `SELECT $x WHERE { $x ?p "unterminated`,
  ``,
];

Deno.test("dispatch is equivalent to exhaustive on Turtle snippets", () => {
  TURTLE_SNIPPETS.forEach((snippet, index) =>
    assertEquivalent(`turtle snippet ${index}`, snippet, turtleRules)
  );
});

Deno.test("dispatch is equivalent to exhaustive on SPARQL snippets", () => {
  SPARQL_SNIPPETS.forEach((snippet, index) =>
    assertEquivalent(`sparql snippet ${index}`, snippet, sparqlRules)
  );
});

Deno.test("dispatch is equivalent to exhaustive on generated people Turtle", () => {
  assertEquivalent("people", buildPeopleTurtle(300), turtleRules);
});

Deno.test("dispatch is equivalent to exhaustive on every W3C Turtle/TriG fixture", () => {
  const paths = filesWithExtensions("test/w3c/fixtures", [".ttl", ".trig"]);
  assert(paths.length > 100);
  for (const path of paths) {
    assertEquivalent(path, Deno.readTextFileSync(path), turtleRules);
  }
});

Deno.test("dispatch is equivalent to exhaustive on every W3C SPARQL fixture", () => {
  const paths = filesWithExtensions("test/w3c/fixtures", [".rq", ".ru"]);
  assert(paths.length > 100);
  for (const path of paths) {
    assertEquivalent(path, Deno.readTextFileSync(path), sparqlRules);
  }
});

Deno.test("dispatch is equivalent to exhaustive for every single character", () => {
  for (let code = 0; code < 0x250; code++) {
    const character = String.fromCharCode(code);
    for (const input of [character, character + " ", "a" + character]) {
      assertEquivalent(`U+${code.toString(16)}`, input, turtleRules);
      assertEquivalent(`U+${code.toString(16)}`, input, sparqlRules);
    }
  }
});

Deno.test("dispatch narrows the candidates for punctuation and keeps order", () => {
  const dispatch = buildLexerDispatch(turtleRules.map(toSticky), false);
  const exhaustive = buildLexerDispatch(turtleRules.map(toSticky), true);
  assert(dispatch.ascii[";".charCodeAt(0)]!.length < 10);
  assertEquals(exhaustive.ascii[0]!.length, turtleRules.length);
  for (const candidates of dispatch.ascii) {
    assertEquals(candidates, [...candidates].sort((a, b) => a - b));
  }
});

Deno.test("rules with an undeterminable first character fall back to all chars", () => {
  const rules = [/(?=a)a/y, /a*/y, /\bb/y, /c$/y, /d/y, /(?:e|f)g/y, /[^h]/y];
  const dispatch = buildLexerDispatch(rules, false);
  const e = "e".charCodeAt(0);
  assertEquals(dispatch.ascii["a".charCodeAt(0)], [0, 1, 2, 3, 6]);
  assertEquals(dispatch.ascii["d".charCodeAt(0)], [0, 1, 2, 3, 4, 6]);
  assertEquals(dispatch.ascii[e], [0, 1, 2, 3, 5, 6]);
  assertEquals(dispatch.end, [0, 1, 2, 3]);
  assertEquals(dispatch.high, [0, 1, 2, 3, 6]);
});

function toSticky(rule: RegExp): RegExp {
  return new RegExp(rule.source.replace(/^\^/, ""), rule.flags + "y");
}

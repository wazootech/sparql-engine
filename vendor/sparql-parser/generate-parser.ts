// deno-lint-ignore-file no-import-prefix
/**
 * Regenerates `parser.cjs` from the in-repo jison grammar (`sparql.jison`).
 *
 * Mirrors sparqljs@3.7.4's own build step:
 *   jison lib/sparql.jison -p slr -m js -o lib/SparqlParser.js
 *   echo 'module.exports=SparqlParser' >> lib/SparqlParser.js
 *
 * Run via `deno task parser:generate`. With `--check`, it verifies instead of
 * writing: it exits non-zero when the checked-in `parser.cjs` has drifted from
 * the grammar (used by `deno task parser:check` in CI).
 */
import jison from "npm:jison@0.4.18";
import { parse as parseGrammar } from "npm:ebnf-parser@0.1.10";

const GRAMMAR_PATH = new URL("./sparql.jison", import.meta.url);
const OUTPUT_PATH = new URL("./parser.cjs", import.meta.url);

// jison@0.4.18 and ebnf-parser@0.1.10 ship no TypeScript types, so their
// surfaces are typed `any` here (guarded by the generation diff in CI).
type JisonModule = {
  Generator: new (
    grammar: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => { generate: (options: Record<string, unknown>) => string };
};
type EbnfParser = { parse: (grammar: string) => Record<string, unknown> };

/** Generates the parser source for the given grammar text (no file I/O). */
export function generateParserSource(rawGrammar: string): string {
  const grammar = (parseGrammar as unknown as EbnfParser["parse"])(rawGrammar);
  const generator = new (jison as unknown as JisonModule).Generator(grammar, {
    type: "slr",
    moduleType: "js",
    moduleName: "SparqlParser",
    debug: false,
  });
  const source = generator.generate({
    type: "slr",
    moduleType: "js",
    moduleName: "SparqlParser",
    debug: false,
  });

  // sparqljs's build appends the CommonJS export line (no preceding newline —
  // jison's `-m js` output ends without one, so this lands directly after
  // `})();`, matching the checked-in file byte-for-byte).
  return `${source}module.exports=SparqlParser\n`;
}

async function main(): Promise<void> {
  const rawGrammar = await Deno.readTextFile(GRAMMAR_PATH);
  const source = generateParserSource(rawGrammar);

  if (Deno.args.includes("--check")) {
    const current = await Deno.readTextFile(OUTPUT_PATH);
    if (current !== source) {
      console.error(
        "parser.cjs is out of date with sparql.jison. " +
          "Run `deno task parser:generate` and commit the result.",
      );
      Deno.exit(1);
    }
    console.log("parser.cjs is up to date with sparql.jison.");
    return;
  }

  await Deno.writeTextFile(OUTPUT_PATH, source);
  console.log(`Generated parser.cjs (${source.length} bytes)`);
}

if (import.meta.main) {
  await main();
}

/**
 * Vendored SPARQL parser — maintained by this project.
 *
 * The runtime parser is a pure ESM/TypeScript module (`parser.ts`) generated
 * from the in-repo jison grammar (`sparql.jison`), itself sparqljs 3.7.4's
 * grammar extended with the SPARQL 1.2 surface upstream lacks — the four
 * direction functions below and the RDF 1.2 triple-term/reifier/annotation
 * forms (see README.md):
 *
 *   - `LANGDIR(literal)`                  — arity 1
 *   - `hasLang(term)`                     — arity 1
 *   - `hasLangDir(term)`                  — arity 1
 *   - `STRLANGDIR(simpleLiteral, langTag, baseDirection)` — arity 3
 *
 * The grammar patch (see README.md) is in two parts: a lexer whitelist
 * extension for the four direction functions (they join existing
 * `FUNC_ARITYn` alternations, so the generated productions already construct
 * `functionCall` nodes), and grammar productions for `<<( s p o )>>` data
 * triple terms, `~` reifiers, `{| |}` annotated triples, standalone
 * `<< s p o >>` reified-triple patterns, and object-level reifier and
 * annotation clauses (`:s :p :o ~ r {| ... |}`).
 *
 * Term construction uses this project's internal zero-dependency DataFactory
 * (`@/term/data-factory.ts`) instead of upstream's `rdf-data-factory`. The
 * AST shapes are identical to upstream sparqljs — this module is a drop-in
 * replacement for the `sparqljs` `Parser` export.
 */
import { DataFactory } from "@/term/data-factory.ts";
import type { SparqlQuery } from "./ast.ts";
export type * from "./ast.ts";

import generatedParser from "./parser.ts";

/** The generated jison parser constructor (upstream `SparqlParser.Parser`). */
type GeneratedParserConstructor =
  & (new () => {
    parse(input: string, options?: Record<string, unknown>): SparqlQuery;
  })
  & {
    // Statics the grammar reads during every parse (set by the wrapper below).
    base: string;
    prefixes: Record<string, string> | null;
    factory: typeof DataFactory;
    sparqlStar: boolean;
    pathOnly: boolean;
    skipValidation: boolean;
    _resetBlanks: () => void;
  };

// Deno's CJS interop exposes the generated singleton as the default export;
// its `.Parser` property is the constructor used by upstream's wrapper.
const GeneratedParser = (generatedParser as unknown as {
  Parser: GeneratedParserConstructor;
}).Parser;

export interface SparqlParserOptions {
  /** Pre-registered prefixes; the standard `xsd:` prefix is always included. */
  prefixes?: Record<string, string>;
  /** Base IRI for resolving relative IRIs in `IRI()` / triple terms. */
  baseIRI?: string;
  /** Enable RDF-star syntax (quoted triples, TRIPLE()/SUBJECT()/...). */
  sparqlStar?: boolean;
  /** Skip sparqljs validation checks (ungrouped-variable projection, ...). */
  skipValidation?: boolean;
}

/**
 * Extended SPARQL parser.
 *
 * Mirrors upstream sparqljs's `Parser` wrapper: a fresh generated-parser
 * instance whose `parse` re-sets the static configuration (base, prefixes,
 * factory, sparqlStar) before delegating — the grammar reads those statics
 * during every parse.
 */
export class Parser {
  private readonly parser: { parse(input: string): SparqlQuery };

  public constructor(options: SparqlParserOptions = {}) {
    const prefixes = options.prefixes ?? {};
    const baseIRI = options.baseIRI ?? "";
    const sparqlStar = Boolean(options.sparqlStar);
    const skipValidation = Boolean(options.skipValidation);

    const generated = new GeneratedParser();
    const generatedParse = generated.parse;

    // Pre-register the standard XSD prefix so value constructors
    // (xsd:integer, xsd:double, ...) parse without an explicit PREFIX clause.
    const prefixTable = {
      xsd: "http://www.w3.org/2001/XMLSchema#",
      ...prefixes,
    };

    generated.parse = function (input: string): SparqlQuery {
      GeneratedParser.base = baseIRI;
      GeneratedParser.prefixes = Object.create(prefixTable);
      GeneratedParser.factory = DataFactory;
      GeneratedParser.sparqlStar = sparqlStar;
      GeneratedParser.pathOnly = false;
      GeneratedParser.skipValidation = skipValidation;
      return generatedParse.apply(this, [input]);
    };

    this.parser = generated;
  }

  /** Parse a raw SPARQL query/update string into a sparqljs AST. */
  public parse(query: string): SparqlQuery {
    return this.parser.parse(query);
  }

  /** Reset the parser's blank-node label counter between parses. */
  public _resetBlanks(): void {
    GeneratedParser._resetBlanks();
  }
}

/** Alias kept for parity with upstream's `SparqlParser` export name. */
export { Parser as SparqlParser };

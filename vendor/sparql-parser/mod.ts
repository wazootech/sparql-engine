/**
 * Vendored SPARQL parser — maintained by this project.
 *
 * The runtime parser is a copy of sparqljs 3.7.4's generated parser
 * (`parser.cjs`), extended with the SPARQL 1.2 direction-function surface
 * that upstream's grammar does not whitelist:
 *
 *   - `LANGDIR(simpleLiteral)`            — arity 1
 *   - `hasLang(langString, language)`     — arity 2
 *   - `STRLANGDIR(simpleLiteral, lang)`   — arity 2
 *   - `hasLangDir(dirLangString, lang, dir)` — arity 3
 *
 * The grammar patch (see README.md) is a pure lexer whitelist extension: the
 * four names join existing `FUNC_ARITYn` alternations, so the generated
 * productions already construct `functionCall` nodes (name lowercased).
 *
 * Term construction uses N3's DataFactory (already a project dependency)
 * instead of upstream's `rdf-data-factory`. The AST shapes are identical to
 * upstream sparqljs — this module is a drop-in replacement for the `sparqljs`
 * `Parser` export.
 */
import { DataFactory } from "n3";
import type { SparqlQuery } from "./ast.ts";
export type * from "./ast.ts";

import generatedParser from "./parser.cjs";

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

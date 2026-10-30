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
import type { SparqlQuery } from "./ast.ts";
export type * from "./ast.ts";
export { SparqlSyntaxError } from "./syntax-error.ts";
import { SparqlSyntaxError, toSparqlSyntaxError } from "./syntax-error.ts";

import { parseSparql } from "./parser.ts";
import {
  resetBlankNodes,
  resetSparqlContext,
  sparqlContext,
} from "./sparql-context.ts";

export { parseTurtleQuads } from "./turtle-parser.ts";

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
 * Mirrors upstream sparqljs's `Parser` wrapper: each `parse` resets the typed
 * parse context (base, prefixes, factory, SPARQL-star and validation options,
 * see `sparql-context.ts`) before running the generated parser, whose
 * semantic actions read that context.
 */
export class Parser {
  private readonly baseIri: string;
  private readonly prefixTable: Map<string, string>;
  private readonly sparqlStar: boolean;
  private readonly skipValidation: boolean;

  public constructor(options: SparqlParserOptions = {}) {
    this.baseIri = options.baseIRI ?? "";
    this.sparqlStar = Boolean(options.sparqlStar);
    this.skipValidation = Boolean(options.skipValidation);

    // Pre-register the standard XSD prefix so value constructors
    // (xsd:integer, xsd:double, ...) parse without an explicit PREFIX clause.
    this.prefixTable = new Map<string, string>();
    this.prefixTable.set("xsd", "http://www.w3.org/2001/XMLSchema#");
    const prefixes = options.prefixes ?? {};
    for (const prefix of Object.keys(prefixes)) {
      this.prefixTable.set(prefix, prefixes[prefix]!);
    }
  }

  /**
   * Parse a raw SPARQL query/update string into a sparqljs AST. The optional
   * baseIRI is the base for relative IRIs when the query has no BASE
   * directive (the directive wins when both are present).
   */
  public parse(
    query: string,
    options: { baseIRI?: string } = {},
  ): SparqlQuery {
    try {
      // The per-parse base overrides the construction-time base, and the
      // grammar's BASE directive action in turn overrides both (resolving
      // the directive against the current base) - so the directive always
      // wins and the option is the fallback, matching sparqljs upstream.
      resetSparqlContext({
        base: options.baseIRI ?? this.baseIri,
        prefixes: this.prefixTable,
        sparqlStar: this.sparqlStar,
        skipValidation: this.skipValidation,
      });
      parseSparql(query);
      return parsedQuery();
    } catch (error) {
      if (error instanceof SparqlSyntaxError) {
        throw error;
      }
      // Map the generated parse/lex error into a typed, position-aware
      // SparqlSyntaxError; non-syntax failures (e.g. sparqljs validation
      // errors) propagate unchanged.
      const syntax = toSparqlSyntaxError(query, error);
      if (syntax !== null) {
        throw syntax;
      }
      throw error;
    }
  }

  /** Reset the parser's blank-node label counter between parses. */
  public _resetBlanks(): void {
    resetBlankNodes();
  }
}

// The result of a successful full-SPARQL parse is a query or an update.
function parsedQuery(): SparqlQuery {
  const result = sparqlContext.result;
  if (result === undefined) {
    throw new Error("The parser produced no result.");
  }
  if ("termType" in result || result.type === "path") {
    throw new Error("Received only path in full SPARQL mode");
  }
  return result;
}

/** Alias kept for parity with upstream's `SparqlParser` export name. */
export { Parser as SparqlParser };

import { Parser as SparqlJsParser } from "sparqljs";
import type { SparqlQuery } from "sparqljs";

/**
 * SparqlParser handles parsing raw SPARQL 1.1 strings into structured AST objects.
 */
export class SparqlParser {
  private readonly parser: SparqlJsParser;

  public constructor() {
    this.parser = new SparqlJsParser();
  }

  /**
   * parse converts a raw SPARQL string into a typed SparqlQuery AST.
   */
  public parse(query: string): SparqlQuery {
    return this.parser.parse(query);
  }
}

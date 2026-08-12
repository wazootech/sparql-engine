import { Parser as SparqlJsParser } from "sparqljs";
import type { SparqlParser as SparqlJsParserType, SparqlQuery } from "sparqljs";

/**
 * SparqlParser handles parsing raw SPARQL 1.1 strings into structured AST objects.
 * The standard xsd: prefix is pre-registered so XSD value constructors
 * (xsd:integer, xsd:double, ...) parse without an explicit PREFIX clause.
 */
export class SparqlParser {
  private readonly parser: SparqlJsParserType;

  public constructor() {
    this.parser = new SparqlJsParser({
      prefixes: { xsd: "http://www.w3.org/2001/XMLSchema#" },
    });
  }

  /**
   * parse converts a raw SPARQL string into a typed SparqlQuery AST.
   */
  public parse(query: string): SparqlQuery {
    return this.parser.parse(query);
  }
}

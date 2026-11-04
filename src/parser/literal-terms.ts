/**
 * literal-terms builds the record literal terms for the SPARQL AST: plain,
 * datatype-tagged and language-tagged (RDF 1.2 direction-aware) literals
 * over the shared term constants in `term-values.ts`.
 */
import type { RdfLiteral, RdfNamedNode, RdfTerm } from "@/parser/rdf-terms.ts";
import {
  namedNodeTerm,
  RDF_DIR_LANG_STRING,
  RDF_LANG_STRING,
  XSD_STRING,
} from "./term-values.ts";

function literalEquals(
  this: RdfLiteral,
  other: RdfTerm | null | undefined,
): boolean {
  if (other === null || other === undefined || other.termType !== "Literal") {
    return false;
  }
  return this.value === other.value && this.language === other.language &&
    (this.direction ?? "") === (other.direction ?? "") &&
    this.datatype.value === other.datatype.value;
}

function literalOf(
  value: string,
  language: string,
  direction: "ltr" | "rtl" | "",
  datatype: RdfNamedNode,
): RdfLiteral {
  return {
    termType: "Literal",
    value,
    language,
    direction,
    datatype,
    equals: literalEquals,
  };
}

/** literalTerm builds a literal with a datatype (xsd:string by default). */
export function literalTerm(
  value: string,
  datatype?: RdfNamedNode,
): RdfLiteral {
  return literalOf(
    value,
    "",
    "",
    datatype === undefined ? namedNodeTerm(XSD_STRING) : datatype,
  );
}

/**
 * languageLiteralTerm builds a language-tagged literal; a direction makes it
 * an rdf:dirLangString literal (RDF 1.2).
 */
export function languageLiteralTerm(
  value: string,
  language: string,
  direction: "ltr" | "rtl" | "",
): RdfLiteral {
  return literalOf(
    value,
    language.toLowerCase(),
    direction,
    namedNodeTerm(direction ? RDF_DIR_LANG_STRING : RDF_LANG_STRING),
  );
}

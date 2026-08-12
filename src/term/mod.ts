export { sameRdfTerm, termKey } from "@/term/identity.ts";
export { rdfTermToSparqlValue, sparqlTermToRdfTerm } from "@/term/convert.ts";
export {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
} from "@/term/canonical.ts";
export {
  compareNumericValues,
  formatNumber,
  NUMERIC_DATATYPES,
  numericValue,
  XSD,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
  XSD_STRING,
} from "@/term/numeric.ts";
export { compareRdfTerms } from "@/term/ordering.ts";
export type { CanonicalTerm } from "@/term/canonical.ts";

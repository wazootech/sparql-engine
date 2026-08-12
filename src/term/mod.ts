export { sameRdfTerm, termKey } from "@/term/identity.ts";
export { rdfTermToSparqlValue, sparqlTermToRdfTerm } from "@/term/convert.ts";
export {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
} from "@/term/canonical.ts";
export {
  canonicalDouble,
  compareNumericValues,
  formatNumber,
  NUMERIC_DATATYPES,
  numericValue,
  XSD,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_DATETIME,
  XSD_DAYTIME_DURATION,
  XSD_INTEGER,
  XSD_STRING,
} from "@/term/numeric.ts";
export {
  parseDateTime,
  timezoneDurationLexical,
} from "@/term/datetime.ts";
export type { DateTimeParts } from "@/term/datetime.ts";
export {
  md5Hex,
  sha1Hex,
  sha256Hex,
  sha384Hex,
  sha512Hex,
} from "@/term/hash.ts";
export { compareRdfTerms } from "@/term/ordering.ts";
export type { CanonicalTerm } from "@/term/canonical.ts";

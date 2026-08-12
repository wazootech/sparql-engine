export type {
  SparqlAskResults,
  SparqlBinding,
  SparqlConstructResults,
  SparqlEngineInterface,
  SparqlRequest,
  SparqlResponse,
  SparqlSelectResults,
  SparqlValue,
} from "@/sparql-engine-interface.ts";
export { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
export type {
  WazooSparqlEngineOptions,
  WazooSparqlTransaction,
} from "@/wazoo-sparql-engine.ts";

export {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  compareNumericValues,
  compareRdfTerms,
  formatNumber,
  NUMERIC_DATATYPES,
  numericValue,
  rdfTermToSparqlValue,
  sameRdfTerm,
  sparqlTermToRdfTerm,
  termKey,
  XSD,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
  XSD_STRING,
} from "@/term/mod.ts";
export type { CanonicalTerm } from "@/term/mod.ts";

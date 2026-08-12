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
export { NativeSparqlEngine } from "@/native-sparql-engine.ts";
export type {
  NativeSparqlEngineOptions,
  NativeSparqlTransaction,
} from "@/native-sparql-engine.ts";

export {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  compareRdfTerms,
  rdfTermToSparqlValue,
  sameRdfTerm,
  sameSparqlValue,
  sparqlTermToRdfTerm,
  sparqlValueKey,
  sparqlValueToRdfTerm,
  termKey,
} from "@/term/mod.ts";
export type { CanonicalTerm } from "@/term/mod.ts";

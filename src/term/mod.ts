export {
  sameRdfTerm,
  sameSparqlValue,
  sparqlValueKey,
  termKey,
} from "@/term/identity.ts";
export {
  rdfTermToSparqlValue,
  sparqlTermToRdfTerm,
  sparqlValueToRdfTerm,
} from "@/term/convert.ts";
export {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
} from "@/term/canonical.ts";
export type { CanonicalTerm } from "@/term/canonical.ts";

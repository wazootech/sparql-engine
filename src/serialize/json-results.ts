import type { SparqlResponse } from "@/sparql-engine-interface.ts";

/**
 * serializeJsonResults serializes a SELECT or ASK SparqlResponse into the
 * SPARQL 1.1 Query Results JSON format ("application/sparql-results+json",
 * the .srj serialization), extended with the SPARQL 1.2 direction and
 * triple-term members the engine's wire format already carries.
 *
 * The response is already in the wire shape (src/sparql-engine-interface.ts):
 * every SparqlValue is emitted as-is — uri/bnode as {type, value}; literals
 * with their "xml:lang", "its:dir" (RDF 1.2 base direction), and datatype
 * members; RDF 1.2 triple terms as the nested {type: "triple", value:
 * {subject, predicate, object}} object — so this is a document builder, not a
 * term re-encoder.
 *
 * Coverage: SELECT (head.vars + results.bindings) and ASK (boolean). The
 * format does not cover CONSTRUCT/DESCRIBE (RDF graph results, serialized as
 * RDF) or updates (void responses carry no result body) — those kinds throw
 * a clear error.
 *
 * Output is deterministic: members are emitted in a fixed order (head, then
 * results/boolean; for literals type, value, xml:lang, its:dir, datatype), so
 * equal responses produce byte-identical documents.
 */
export function serializeJsonResults(response: SparqlResponse): string {
  switch (response.kind) {
    case "select": {
      // A fixed-order literal per case (rather than a mutable
      // Record<string, unknown>) keeps the document builder out of the native
      // compiler's dynamic tier while preserving member order.
      const head = response.data.head;
      return JSON.stringify({
        head: head.link?.length
          ? { vars: head.vars, link: head.link }
          : { vars: head.vars },
        results: { bindings: response.data.results.bindings },
      });
    }
    case "ask": {
      const head = response.data.head;
      // The empty-head form is a separate return: a conditional whose branches
      // are `{ link }` and `{}` gives the object literal two shapes, which the
      // native compiler treats as an object literal built from dynamic values.
      if (head.link?.length) {
        return JSON.stringify({
          head: { link: head.link },
          boolean: response.data.boolean,
        });
      }
      return JSON.stringify({
        head: {},
        boolean: response.data.boolean,
      });
    }
    case "construct":
    case "void":
      throw new Error(
        `serializeJsonResults: cannot serialize a ${response.kind} response ` +
          "— the SPARQL results JSON format covers SELECT and ASK only " +
          "(CONSTRUCT/DESCRIBE results are RDF graphs; updates have no " +
          "result body)",
      );
  }
}

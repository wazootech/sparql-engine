/**
 * query-forms.ts holds what ASK, CONSTRUCT and DESCRIBE share with SELECT.
 */

import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";
import type {
  AskQuery,
  ConstructQuery,
  DescribeQuery,
  SelectQuery,
} from "@/parser/sparql-parser.ts";
import { DataFactory } from "@/term/mod.ts";
import {
  narrowQuadObject,
  narrowQuadPredicate,
  narrowQuadSubject,
} from "@/term/quad-narrow.ts";

/**
 * solutionsQuery is the SELECT * whose solutions an ASK, CONSTRUCT or DESCRIBE
 * query consumes, so every form applies the same solution modifiers and the
 * trailing VALUES clause (SPARQL 1.1 §18.2.4–§18.2.5).
 */
export function solutionsQuery(
  query: AskQuery | ConstructQuery | DescribeQuery,
): SelectQuery {
  return {
    type: "query",
    queryType: "SELECT",
    base: query.base,
    from: query.from,
    where: query.where,
    group: query.group,
    having: query.having,
    order: query.order,
    limit: query.limit,
    offset: query.offset,
    values: query.values,
    variables: [{ termType: "Wildcard", value: "*" }],
  };
}

/**
 * templateTriple builds a triple from instantiated template terms, or null when
 * a term may not stand in its position: CONSTRUCT leaves such a triple out
 * (SPARQL 1.1 §16.2).
 */
export function templateTriple(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
): RdfQuad | null {
  const s = narrowQuadSubject(subject);
  const p = narrowQuadPredicate(predicate);
  const o = narrowQuadObject(object);
  if (s === undefined || p === undefined || o === undefined) {
    return null;
  }
  return DataFactory.quad(s, p, o, DataFactory.defaultGraph());
}

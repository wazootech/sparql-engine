/**
 * query-forms.ts holds what ASK, CONSTRUCT and DESCRIBE share with SELECT.
 */

import type { RdfTerm } from "@/parser/rdf-terms.ts";
import type {
  AskQuery,
  ConstructQuery,
  DescribeQuery,
  SelectQuery,
} from "@/parser/sparql-parser.ts";

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
 * isTemplateTriple reports whether instantiated template terms may stand in
 * their positions: CONSTRUCT leaves any other triple out (SPARQL 1.1 §16.2).
 */
export function isTemplateTriple(
  subject: RdfTerm,
  predicate: RdfTerm,
  object: RdfTerm,
): boolean {
  const subjectFits =
    subject.termType === "NamedNode" ||
    subject.termType === "BlankNode" ||
    subject.termType === "Quad";
  const objectFits =
    object.termType !== "Variable" && object.termType !== "DefaultGraph";
  return subjectFits && predicate.termType === "NamedNode" && objectFits;
}

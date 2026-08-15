/**
 * PRIOR_ART is the canonical registry of the external prior art this engine
 * builds on — research papers, standards, RFCs, and reference books — each
 * cited exactly once under a stable key.
 *
 * The collocated JSDoc blocks across the codebase reference these keys via
 * `@cite PRIOR_ART.<KEY>` tags instead of duplicating the citation text, so
 * a typo, page range, or dead link is fixed in this one module and every
 * collocated comment picks it up. When adding a citation: add the entry
 * here first, then reference the key from the collocated comment.
 *
 * Links were verified to resolve at the time of writing (August 2026);
 * ACM-hosted DOIs (doi.org/10.1145/...) were confirmed against the
 * Crossref API.
 */
export const PRIOR_ART = {
  /**
   * Greedy, selectivity-driven BGP join reordering — the technique behind
   * BgpEvaluator.reorderPatterns (each pattern scanned once, then joined in
   * ascending estimated cost; the estimate blends true store cardinality
   * with bound-variable selectivity).
   */
  STOCKER_2008:
    `Stocker, M., Seaborne, A., Bernstein, A., Kiefer, C., & Reynolds, D. ` +
    `"SPARQL Basic Graph Pattern Optimization Using Selectivity Estimation." ` +
    `Proc. 17th Intl. World Wide Web Conf. (WWW '08), ACM, 2008, pp. 595–604. ` +
    `https://doi.org/10.1145/1367497.1367578`,

  /**
   * Cost-based access-path selection and join ordering (System R) — the
   * root of the engine's cost estimates, method dispatch, and
   * smallest-bucket probe choices.
   */
  SELINGER_1979:
    `Selinger, P. G., Astrahan, M. M., Chamberlin, D. D., Lorie, R. A., & ` +
    `Price, T. G. "Access Path Selection in a Relational Database Management ` +
    `System." Proc. ACM SIGMOD, 1979, pp. 23–34. ` +
    `https://doi.org/10.1145/582095.582099`,

  /**
   * In-memory hash join (build the right side once, probe per left tuple) —
   * the scheme behind the join.ts hash join.
   */
  SHAPIRO_1986:
    `Shapiro, L. D. "Join Processing in Database Systems with Large Main ` +
    `Memories." ACM Transactions on Database Systems 11(3), 1986, ` +
    `pp. 239–264. https://doi.org/10.1145/6314.6315`,

  /** The GRACE relational algebra machine, which made hash joins viable. */
  KITSURESAWA_1983:
    `Kitsuregawa, M., Tanaka, H., & Yamamori, T. "Architecture and ` +
    `Performance of Relational Algebra Machine GRACE." Proc. Intl. Conf. on ` +
    `Parallel Processing (ICPP), 1983, pp. 241–250.`,

  /**
   * Survey of query evaluation techniques — join strategies and cost-based
   * method selection (the JOIN_PRODUCT_THRESHOLD dispatch), plus
   * hash-based grouping/aggregation (aggregate.ts).
   */
  GRAEFE_1993:
    `Graefe, G. "Query Evaluation Techniques for Large Databases." ACM ` +
    `Computing Surveys 25(2), 1993, pp. 73–170. ` +
    `https://doi.org/10.1145/152610.152611`,

  /**
   * Volcano — the iterator/pipeline model the lazy (generator-based)
   * solution flow between patterns implements.
   */
  GRAEFE_1994:
    `Graefe, G. "Volcano — An Extensible and Parallel Query Evaluation ` +
    `System." IEEE Transactions on Knowledge and Data Engineering 6(1), ` +
    `1994, pp. 120–135. https://doi.org/10.1109/69.273032`,

  /** RDF-3X — exhaustive positional indexing of RDF triples. */
  NEUMANN_WEIKUM_2008:
    `Neumann, T., & Weikum, G. "RDF-3X: A RISC-Style Engine for RDF." Proc. ` +
    `VLDB Endowment 1(1), 2008, pp. 647–659. ` +
    `https://doi.org/10.14778/1453856.1453927`,

  /** Hexastore — per-position mirror indexes for RDF data management. */
  WEISS_2008:
    `Weiss, C., Karras, P., & Bernstein, A. "Hexastore: Sextuple Indexing ` +
    `for Semantic Web Data Management." Proc. VLDB Endowment 1(1), 2008, ` +
    `pp. 1008–1019. https://doi.org/10.14778/1453856.1453965`,

  /**
   * Formal semantics and complexity of the SPARQL algebra (Join, LeftJoin,
   * Minus, Filter, Extend, Union) the pattern evaluator implements.
   */
  PEREZ_2009:
    `Pérez, J., Arenas, M., & Gutierrez, C. "Semantics and Complexity of ` +
    `SPARQL." ACM Transactions on Database Systems 34(3), 2009, art. 16. ` +
    `https://doi.org/10.1145/1567274.1567278`,

  /**
   * Semi-join reduction — the model for evaluating correlated EXISTS as a
   * probe of a once-drained candidate set.
   */
  BERNSTEIN_CHIU_1981:
    `Bernstein, P. A., & Chiu, D.-M. W. "Using Semi-Joins to Solve Relational ` +
    `Queries." Journal of the ACM 28(1), 1981, pp. 25–40. ` +
    `https://doi.org/10.1145/322234.322238`,

  /** Multiple-query optimization — sharing one scan across many bindings. */
  SELLIS_1988:
    `Sellis, T. K. "Multiple-Query Optimization." ACM Transactions on ` +
    `Database Systems 13(1), 1988, pp. 23–52. ` +
    `https://doi.org/10.1145/42201.42203`,

  /**
   * Floating-point arithmetic analysis — the motivation for the exact
   * fixed-point decimal sums in the aggregates.
   */
  GOLDBERG_1991:
    `Goldberg, D. "What Every Computer Scientist Should Know About ` +
    `Floating-Point Arithmetic." ACM Computing Surveys 23(1), 1991, ` +
    `pp. 5–48. https://doi.org/10.1145/103162.103163`,

  /** Formal semantics of SPARQL property paths (set vs multiset paths). */
  KOSTYLEV_2015:
    `Kostylev, E. V., Reutter, J. L., Romero, M., & Vrgoč, D. "SPARQL with ` +
    `Property Paths." Proc. 14th Intl. Semantic Web Conf. (ISWC 2015), LNCS ` +
    `9366, Springer, 2015, pp. 3–18. ` +
    `https://doi.org/10.1007/978-3-319-25007-6_1`,

  /** SPARQL 1.1 Query Language — the engine's primary normative source. */
  HARRIS_SEABORNE_2013:
    `Harris, S., & Seaborne, A. (eds.). "SPARQL 1.1 Query Language." W3C ` +
    `Recommendation, 21 March 2013. https://www.w3.org/TR/sparql11-query/`,

  /** XQuery/XPath 2.0 Functions and Operators — builtin function semantics. */
  MALHOTRA_2010:
    `Malhotra, A., Melton, J., & Walsh, N. (eds.). "XQuery 1.0 and XPath 2.0 ` +
    `Functions and Operators (Second Edition)." W3C Recommendation, 14 ` +
    `December 2010. https://www.w3.org/TR/2010/REC-xpath-functions-20101214/`,

  /** The MD5 message-digest algorithm (SPARQL 1.1 §17.4.1.7 delegates here). */
  RIVEST_1992:
    `Rivest, R. "The MD5 Message-Digest Algorithm." IETF RFC 1321, April ` +
    `1992. https://www.rfc-editor.org/rfc/rfc1321`,

  /** The Secure Hash Standard — SHA-1/SHA-256/SHA-384/SHA-512. */
  NIST_2015:
    `National Institute of Standards and Technology. "Secure Hash Standard ` +
    `(SHS)." FIPS PUB 180-4, August 2015. ` +
    `https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf`,

  /**
   * RDF* / SPARQL* foundations — the conceptual model behind the engine's
   * triple-term and reification surface.
   */
  HARTIG_2017:
    `Hartig, O. "Foundations of RDF* and SPARQL* (An Alternative Approach to ` +
    `Statement-Level Metadata in Linked Data)." Proc. 11th Alberto Mendelzon ` +
    `Intl. Workshop on Foundations of Data Management (AMW), CEUR-WS ` +
    `Vol-1912, 2017. https://ceur-ws.org/Vol-1912/paper12.pdf`,

  /** RDF 1.2 Concepts — triple terms and the rdf:reifies representation. */
  RDF12_CONCEPTS: `"RDF 1.2 Concepts and Abstract Data Model." W3C Candidate ` +
    `Recommendation, 7 April 2026. https://www.w3.org/TR/rdf12-concepts/`,

  /** Materialized-view maintenance — the version-cached EXISTS snapshot. */
  GUPTA_MUMICK_1995:
    `Gupta, A., & Mumick, I. S. "Maintenance of Materialized Views: ` +
    `Problems, Techniques and Applications." IEEE Data Engineering Bulletin ` +
    `18(2), 1995, pp. 3–18. https://dblp.org/rec/journals/debu/GuptaM95.html`,

  /** Breadth-first search — the traversal behind the path * and + closures. */
  CORMEN_2009: `Cormen, T. H., Leiserson, C. E., Rivest, R. L., & Stein, C. ` +
    `"Introduction to Algorithms," 3rd ed. MIT Press, 2009, §22.2 ` +
    `(breadth-first search).`,

  /** Table-driven LR parsing — the technique jison generates for the parser. */
  AHO_1986: `Aho, A. V., Sethi, R., & Ullman, J. D. "Compilers: Principles, ` +
    `Techniques, and Tools." Addison-Wesley, 1986, ch. 4 (syntax analysis, ` +
    `LR parsing).`,
} as const;

/** The stable key of every citation in PRIOR_ART. */
export type PriorArtKey = keyof typeof PRIOR_ART;

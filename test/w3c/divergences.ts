/**
 * Documented-divergence allowlist for the W3C differential runner.
 *
 * Per the "Decide whether to adopt the W3C SPARQL 1.1 suite as the shared
 * fixture base" resolution, the parity-gap count is the tracked metric and
 * allowlist entries exist ONLY for documented decisions where the native
 * engine is spec-correct and Comunica lite deviates (e.g. the malformed
 * regex throw) — never for unimplemented surface. Each entry's value is the
 * documented reason, mirroring the divergence list on the wayfinder map.
 *
 * Key format: `<category>:<manifest-local-name>`.
 */
export const documentedDivergences: Record<string, string> = {
  // COUNT inside GRAPH with no GROUP BY: the subquery yields one solution per
  // named graph (empty matches still produce COUNT=0), so the outer query has
  // two rows — one per graphData entry. Comunica lite collapses them into a
  // single ungrouped row and drops the ?g binding. Native matches the W3C
  // reference. (SPARQL 1.1 Query §18.2.2.2 aggregation, §13.3 GRAPH.)
  "aggregates:agg-empty-group-count-graph":
    "Native returns the two spec rows (singleton -> 0, pair -> 2); Comunica collapses to one ungrouped row and drops ?g. SPARQL 1.1 Query §18.2.2.2/§13.3.",

  // VALUES inside GRAPH binding the same variable as the graph name: the
  // VALUES row binds ?g and ?t, and GRAPH ?g joins those with the named
  // graphs, keeping ?g bound. Native returns the three reference rows
  // (matching graph.ttl); Comunica lite drops the ?g binding and returns two.
  // (SPARQL 1.1 Query §10.2 VALUES, §13.3 GRAPH.)
  "bindings:graph":
    "Native keeps ?g bound through VALUES-in-GRAPH (3 rows, matching graph.ttl); Comunica drops ?g (2 rows). SPARQL 1.1 Query §10.2/§13.3.",

  // LOAD ... SILENT: a failed remote retrieval must be ignored, leaving the
  // store unchanged. Native honors SILENT; Comunica lite has no loader for
  // the somescheme:// IRI and throws a query-source identification error.
  // (SPARQL 1.1 Update §3.1.3 LOAD.)
  "update-silent:load-silent":
    "Native ignores the unloadable somescheme:// IRI per SILENT; Comunica lite throws a query-source identification error. SPARQL 1.1 Update §3.1.3.",

  // LOAD ... INTO GRAPH ... SILENT: same as LOAD SILENT, but targeting a
  // named graph. Native honors SILENT and leaves the graph unchanged;
  // Comunica lite throws on the unloadable IRI. (SPARQL 1.1 Update §3.1.3.)
  "update-silent:load-into-silent":
    "Native ignores the unloadable somescheme:// IRI per SILENT; Comunica lite throws a query-source identification error. SPARQL 1.1 Update §3.1.3.",
};

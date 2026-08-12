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
  // Populated only when a W3C test hits a divergence already recorded as a
  // decided Comunica bug. Nothing qualifies yet.
};

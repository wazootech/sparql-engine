---
title: Supplemental Context
layout: default
---

# Supplemental Context

Repository metadata, vendored datasets, [W3C](https://www.w3.org/) compliance
notes, and glossary pointers. This page is intentionally secondary: engine
architecture, parsing, and execution live in
[02 — Architecture](02-architecture.md) and [04 — Source Map](04-source-map.md).

## Repository metadata

| Field                 | Value                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Package               | `@wazoo/sparql-engine` (JSR), version `0.4.1`, MIT                                                                  |
| Runtime               | Deno 2.x (Node.js and browser via JSR; durable `node:sqlite` store lives in `@worlds/sqlite`, server-only)          |
| Runtime dependencies  | **zero** — only type-only `@rdfjs/types`                                                                            |
| Dev/test dependencies | `@comunica/query-sparql-rdfjs-lite`, `oxigraph` (WASM), `n3`, `@std/assert`, `@types/node`                          |
| Manifest              | `deno.json` (`exports["."] → ./src/mod.ts`, `@/` → `./src/`)                                                        |
| CI                    | `.github/workflows/ci.yml` (`ci`, `w3c-parity`, `latency-snapshot`, `docs-drift`, `docs-links` jobs), `publish.yml` |

The "zero runtime dependencies" property is load-bearing: the package is
browser-friendly and JSR-ready without transitive npm baggage. The vendored
parser (`src/parser/parser.ts`), the Turtle parser
(`src/parser/turtle-generated.ts`), the RDF/JS factory
(`src/term/data-factory.ts`), and the hash functions (`src/term/hash.ts`) all
exist in-repo to preserve it.

## Sample RDF datasets

There are no hand-rolled toy datasets in the repo; the data that exercises the
engine is generated or vendored:

| Where                                                                  | What it is                                                                                                                                       | Used by                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `bench/engine_bench.ts` (`buildDataset`)                               | Generated ring of 400 people: foaf:name, xsd:integer age, blank-node pets, knows edges, 5 city tags, spouse edges on even indices (~1,600 quads) | All three-engine benchmarks                    |
| `bench/engine_bench.ts` (`buildGraphDataset` / `buildGraphOpsDataset`) | 200 person quads in `<http://example.org/g1>`; g1 + 50-quad g2 for ADD/COPY/MOVE/CLEAR/DROP                                                      | GRAPH/FROM benchmarks and graph-op updates     |
| `bench/memory-probe.ts` (`buildPeopleDataset`)                         | 10,000-person graph, ~55k quads (foaf:name/age, pets, cities, spouses) — the peak-memory workload                                                | `deno task bench:memory`                       |
| `test/parity/parity-fixtures.ts` (`createQuadStore`)                   | Small seeded stores for differential parity cases                                                                                                | `test/parity/*.test.ts`                        |
| `test/w3c/fixtures/sparql11/`                                          | W3C [SPARQL 1.1](https://www.w3.org/TR/sparql11-query/) evaluation-core                                                                          | `deno task test:w3c`                           |
| `test/w3c/fixtures/sparql12/`                                          | W3C [SPARQL 1.2](https://www.w3.org/TR/sparql12-query/) evaluation suite + triple-terms gap suite                                                | `deno task test:sparql12`, `test:sparql12:gap` |
| `test/w3c/fixtures/rdf/`                                               | RDF 1.1 + 1.2 Turtle/TriG/N-Triples/N-Quads syntax suites                                                                                        | `deno task test:rdf11`, `test:rdf12`           |
| `test/w3c/exists-ref.ts`                                               | Small inline Turtle graph (7 triples) cross-checked vs Oxigraph                                                                                  | `deno task test:exists-ref`                    |

The W3C fixtures are vendored snapshots of `w3c/rdf-tests` (gh-pages branch) so
CI is deterministic and offline-capable. Query and data files resolve against
canonical `http://www.w3.org/2009/sparql/docs/tests/data-sparql11/...` URLs so
relative IRIs (including the empty IRI `<>`) resolve identically in both
engines. Refresh procedures are in `test/w3c/README.md`.

## W3C compliance posture

The project does not run the W3C suites as a pass/fail conformance oracle alone
— it runs them **differentially against [Comunica](https://comunica.dev/)**,
with the W3C reference results as a secondary check. The posture is:

1. **Parity is the floor.** Anything the parity reference
   (`@comunica/query-sparql-rdfjs-lite`) can do, the wazoo engine must do.
2. **Spec wins over the reference.** Where Comunica contradicts the spec
   (`LIMIT 0` ignored, malformed regex throwing, EXISTS subquery correlation),
   the wazoo engine implements the spec and the case is keyed as a _documented
   divergence_ in `test/w3c/divergences.ts` rather than allowlisted blindly.
3. **Gaps are tracked, not hidden.** The `w3c-parity` CI job goes green only on
   a full pass; the gap count is the progress metric.
4. **RDF syntax is gated absolutely.** Negative syntax tests must be rejected
   even when the lenient reference (n3) accepts them; the only tolerated
   mismatches are _superset acceptances_ — the wazoo grammar is a single
   Turtle+TriG+N-Quads superset for `LOAD`'s content-sniffing — each audited
   against Oxigraph and N3.js by `deno task test:ref` (all endorsed).

Current standing: the SPARQL 1.2 evaluation suite (differential vs Comunica),
the RDF 1.2 eval-triple-terms gap suite, and the SPARQL 1.1 evaluation-core all
pass for the w3c-parity job, plus the RDF 1.1/1.2 syntax gates and the Oxigraph
EXISTS cross-check. Counts are asserted by the runners themselves on every CI
run — the runner output, not this page, is the oracle.

## Blank-node semantics (a deliberate difference)

SPARQL 1.1 result semantics treat blank-node labels as scoped and opaque.
Comunica skolemizes blank nodes from query sources into prefixed labels
(`bc_<sourceId>_<label>`); the wazoo engine returns the store's own labels and
deliberately does **not** replicate the prefix. The parity harness strips the
prefix before comparing and locks the normalization with a dedicated test
(`test/parity/parity.test.ts`). INSERT DATA mints fresh labels per execution
(`u<N>` natively, `e_<label>NN` under Comunica); stores are compared modulo
label identity.

## Glossary (from `CONTEXT.md`)

- **WazooSparqlEngine** — the in-repo engine; must be observably interchangeable
  with the parity reference.
- **SparqlEngineInterface** — the shared execution contract; single source of
  truth in this package, re-exported by `@worlds/sdk`.
- **ComunicaSparqlEngine** — the retired `@worlds/sdk` adapter
  (`@worlds/sdk/comunica`) the wazoo engine used to mirror; removed from the
  SDK, kept only as a parity reference.
- **Parity reference** — the installed `@comunica/query-sparql-rdfjs-lite`; the
  porting surface is its lite config.
- **Differential parity** — deep comparison of SELECT bindings, CONSTRUCT quads,
  ASK booleans, and final update store contents across engines.
- **Spec-wins divergence** — the reference contradicts the spec; wazoo
  implements the spec, documents it, and skips the parity case.
- **Superset directive** — parity is the floor; the superset ceiling (what
  beyond that floor the engine should carry) is an open question.
- **Pattern-evaluation hook** — the injected
  `evaluateExists(pattern,
  solution) => boolean` seam binding the pure
  expression layer to the graph scope and active dataset. Backed by a per-call
  [`ExistsSnapshot`](https://github.com/wazootech/sparql-engine/blob/main/src/evaluator/bgp-evaluator.ts)
  (issue [#72](https://github.com/wazootech/sparql-engine/issues/72)), so
  concurrent evaluations stay isolated.
- **Correlated evaluation** — inner patterns see the outer solution's bindings;
  inner bindings never leak out.

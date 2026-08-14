---
title: Source Map & Module Directory
layout: default
---

# Source Map & Module Directory

Complete walkthrough of the repository layout. Every path is relative to the
repo root; line numbers are the declaration sites reported by `deno doc --json`
(public symbols) or the current source.

```
sparql-engine/
├── deno.json                 package manifest (JSR), tasks, imports (@/ → ./src/)
├── README.md                 usage + parity + benchmarking overview
├── ARCHITECTURE.md           topology, contracts, @worlds/client relationship
├── CONTEXT.md                glossary (engine, parity, spec-wins divergence, ...)
├── src/                      the package (all engine code)
│   ├── mod.ts                public exports (the only public entrypoint)
│   ├── sparql-engine-interface.ts   request/response envelopes
│   ├── wazoo-sparql-engine.ts       engine orchestrator
│   ├── quad-store.ts                store adapters + quad indexes
│   ├── parser/                     vendored SPARQL parser
│   ├── evaluator/                  query & update evaluation
│   ├── store/                      rdfjs.Store implementations
│   └── term/                       term algebra (identity/convert/order/...)
├── test/
│   ├── parity/               differential tests vs Comunica
│   └── w3c/                  W3C SPARQL 1.1/1.2 + RDF 1.1/1.2 gates, fixtures/
├── bench/                    benchmarks + regression budget
├── docs/                     this wiki
└── .github/workflows/        ci.yml (ci + w3c-parity jobs), publish.yml
```

## `src/` — the package

### Entry point

| File         | Symbols (line)                       | Role                                                                                                          |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `src/mod.ts` | re-exports everything public (L1–40) | The only public entrypoint (`exports["."]` in `deno.json`). Anything not re-exported here is private surface. |

### Engine core

| File                             | Symbols (line)                                                                                                                                                                                 | Role                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/sparql-engine-interface.ts` | `SparqlEngineInterface` L5, `SparqlRequest` L17, `SparqlResponse` L34, `SparqlAskResults` L43, `SparqlSelectResults` L53, `SparqlConstructResults` L66, `SparqlValue` L74, `SparqlBinding` L97 | Typed envelopes; duplicated identically in `@worlds/client` (identical-spec policy).                                 |
| `src/wazoo-sparql-engine.ts`     | `WazooSparqlTransaction` L15, `WazooSparqlEngineOptions` L32, `WazooSparqlEngine` L55                                                                                                          | Orchestrator: parse → dispatch query/update. Implements `SparqlEngineInterface`, drop-in for `ComunicaSparqlEngine`. |
| `src/quad-store.ts`              | `QuadIndex` L11, `buildQuadIndex` L21, `probeQuadIndex` L56, `matchQuads` L89, `simplePredicate` L120, `GraphScopedStore` L134, `namedGraphs` L157, `buildDatasetStore` L180                   | The store-adapter layer: stream draining, positional indexes, graph scoping, active-dataset materialization.         |
| `src/quad-store.test.ts`         | —                                                                                                                                                                                              | Unit tests for the adapter layer.                                                                                    |

### `src/parser/` — vendored SPARQL parser

| File                                              | Symbols (line)                                                   | Role                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/parser/sparql-parser.ts`                     | `SparqlParser` L9                                                | The engine's parser entry: wraps `Parser` with `sparqlStar: true` and the standard `xsd:` prefix.                        |
| `src/parser/mod.ts`                               | `SparqlParserOptions` L55, `Parser` L74 (aliased `SparqlParser`) | Maintained wrapper over the generated parser; injects the zero-dep `DataFactory`, sets base/prefixes per parse.          |
| `src/parser/ast.ts`                               | `Term` L2 … `SparqlQuery` L287 (every AST type)                  | sparqljs-compatible AST shape, incl. `ReifiedQuad` (L23, `tripleTerm`/`reifier` markers) and `PropertyPath` (L30).       |
| `src/parser/parser.ts`                            | generated (9608 lines)                                           | Pure-ESM jison parser generated from `sparql.jison`; never hand-edited.                                                  |
| `src/parser/sparql.jison`                         | —                                                                | Grammar source of truth: sparqljs 3.7.4 + SPARQL 1.2 patches (direction functions, triple terms, reifiers, annotations). |
| `src/parser/generate-parser.ts`                   | —                                                                | Codegen script (`deno task parser:generate`); `--check` verifies sync.                                                   |
| `src/parser/turtle-parser.ts`                     | `parseTurtleQuads` L46                                           | Jison Turtle/TriG/N-Triples/N-Quads parser backing `LOAD`; RDF 1.2 triple terms/reifiers included.                       |
| `src/parser/turtle-generated.ts`                  | generated (2618 lines)                                           | Generated from `src/parser/turtle.jison`.                                                                                |
| `src/parser/README.md`                            | —                                                                | Parser architecture, the exact SPARQL 1.2 patch, regeneration procedure.                                                 |
| `src/parser/mod.test.ts`, `turtle-parser.test.ts` | —                                                                | Parser unit tests.                                                                                                       |
| `src/parser/LICENSE`                              | —                                                                | Upstream sparqljs MIT license (required for redistribution).                                                             |

### `src/evaluator/` — evaluation

| File                       | Symbols (line)                                                                                                                                                                                                                                                                                                                                                                                              | Role                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sparql-evaluator.ts`      | `SparqlEvaluatorOptions` L45, `SparqlEvaluator` L66                                                                                                                                                                                                                                                                                                                                                         | Query dispatch (SELECT/ASK/CONSTRUCT/DESCRIBE), FROM-dataset setup, CONSTRUCT/DESCRIBE assembly, ORDER BY.                                                  |
| `bgp-evaluator.ts`         | `ExistsSnapshot` L55 (internal), `BgpEvaluatorOptions` L63, `BgpEvaluator` L89, `patternListContainsExists` L1044                                                                                                                                                                                                                                                                                           | Pattern algebra: group evaluation, OPTIONAL/MINUS/UNION/GRAPH/BIND/VALUES, subqueries, and the synchronous EXISTS evaluator (per-call snapshot, issue #72). |
| `join.ts`                  | `TermBinding` L20, `ScanEntry` L27, `BindingFilter` L51, `bindingsCompatible` L58, `leftJoin` L78, `innerJoin` L110, `minus` L131, `scanEntry` L157, `joinTriplePattern` L213, `PathPair` L449, `PathEntry` L458, `isPropertyPath` L473, `isMultisetPath` L489, `scanPathEntry` L510, `joinPathPattern` L562, `matchQuadsSync` L934, `graphNodesSync` L952, `pathStepsSync` L971, `scanPathEntrySync` L1232 | The join engine: hash joins, binding-set algebra, property paths, plus the synchronous twins used by EXISTS.                                                |
| `expression-evaluator.ts`  | `ExpressionEvaluationContext` L115, `ExpressionEvaluator` L150                                                                                                                                                                                                                                                                                                                                              | SPARQL expression evaluation: operators, string/numeric/date functions, XSD constructors, hashes, EXISTS hooks.                                             |
| `expression-utils.ts`      | `expressionContainsExists` L8, `expressionContainsAggregate` L39                                                                                                                                                                                                                                                                                                                                            | AST walks that decide whether the EXISTS index / aggregate path is needed.                                                                                  |
| `select-pipeline.ts`       | `SelectSolution` L25, `pipelineNeedsExistsIndex` L36, `applySelectPipeline` L57                                                                                                                                                                                                                                                                                                                             | The shared SELECT post-processing pipeline (VALUES, grouping, HAVING, ORDER BY, projection, DISTINCT/REDUCED, OFFSET/LIMIT).                                |
| `aggregate.ts`             | `SolutionGroup` L29, `groupSolutions` L41, `aggregateValue` L91                                                                                                                                                                                                                                                                                                                                             | GROUP BY partitioning and aggregate computation (exact BigInt sums).                                                                                        |
| `reified.ts`               | `RDF_REIFIES` L15, `expandReifiedTriples` L87, `isReifiesPattern` L115                                                                                                                                                                                                                                                                                                                                      | RDF 1.2 reified-triple pattern expansion into `rdf:reifies` triples.                                                                                        |
| `update-evaluator.ts`      | `QuadWriteStore` L34, `UpdateEvaluatorOptions` L42, `UpdateEvaluator` L90                                                                                                                                                                                                                                                                                                                                   | SPARQL Update execution: all operation types, transactions, template instantiation, DELETE matching, LOAD.                                                  |
| `update-evaluator.test.ts` | —                                                                                                                                                                                                                                                                                                                                                                                                           | Update unit tests.                                                                                                                                          |

### `src/store/` — RDF/JS stores

| File                   | Symbols (line)                                | Role                                                                             |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `memory-store.ts`      | `MemoryStream` L36, `MemoryStore` L229        | Zero-dependency in-memory store + RDF/JS stream implementation.                  |
| `memory-store.test.ts` | —                                             | Store unit tests.                                                                |
| `sqlite-store.ts`      | `SqliteStoreOptions` L120, `SqliteStore` L196 | Durable store over `node:sqlite`; server-only, deep-import, not in `src/mod.ts`. |
| `sqlite-store.test.ts` | —                                             | Durability/atomicity tests.                                                      |

### `src/term/` — term algebra

| File              | Symbols (line)                                                                                                                   | Role                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `mod.ts`          | re-exports the term layer                                                                                                        | Single import point for the evaluator.                          |
| `identity.ts`     | `termKey` L8, `sameRdfTerm` L41                                                                                                  | Sound identity: hashing keys and structural equality.           |
| `convert.ts`      | `sparqlTermToRdfTerm` L11, `rdfTermToSparqlValue` L44                                                                            | AST ⇄ RDF/JS ⇄ wire conversion.                                 |
| `canonical.ts`    | `CanonicalTerm` L10, `canonicalizeRdfTerm` L26, `canonicalizeSparqlValue` L65                                                    | Serialization-stable projections for differential parity.       |
| `numeric.ts`      | `XSD*` L5–29, `NUMERIC_DATATYPES` L36, `numericValue` L49, `compareNumericValues` L69, `formatNumber` L88, `canonicalDouble` L97 | Numeric value semantics + canonical double lexical form.        |
| `ordering.ts`     | `compareRdfTerms` L66                                                                                                            | SPARQL §12.4 term ordering for ORDER BY / MIN / MAX / DISTINCT. |
| `datetime.ts`     | `DateTimeParts` L10, `parseDateTime` L43, `timezoneDurationLexical` L92                                                          | xsd:dateTime parsing and timezone handling.                     |
| `hash.ts`         | `md5Hex` L87, `sha1Hex` L156, `sha256Hex` L299, `sha384Hex` L557, `sha512Hex` L565                                               | Zero-dependency hash implementations for the hash functions.    |
| `data-factory.ts` | `NamedNodeImpl` L10 … `DataFactory` L200, `dataFactory` L238                                                                     | Zero-dependency RDF/JS factory (also used by the parser).       |
| `term.test.ts`    | —                                                                                                                                | Term unit tests.                                                |

## `test/` — verification surface

| Path                                                                    | Role                                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `test/parity/parity.test.ts`                                            | Differential query parity vs `@comunica/query-sparql-rdfjs-lite`                              |
| `test/parity/parity-update.test.ts`                                     | Differential update parity (final store contents, up to bnode relabeling)                     |
| `test/parity/parity-harness.ts`                                         | Shared harness: canonicalization, blank-node normalization, Comunica engine setup             |
| `test/parity/parity-fixtures.ts`                                        | Seeded stores for parity cases                                                                |
| `test/parity/canonical-store.test.ts`                                   | Unit-tests `canonicalStoreQuads` blank-node substitution (repeated placeholders, isomorphism) |
| `test/w3c/w3c-main.ts`                                                  | SPARQL 1.1 evaluation-core differential runner (`deno task test:w3c`)                         |
| `test/w3c/sparql12-main.ts`, `sparql12-gap.ts`                          | SPARQL 1.2 suite + RDF 1.2 triple-terms gap suite                                             |
| `test/w3c/rdf-differential.ts`, `rdf-classify.ts`                       | RDF 1.1/1.2 Turtle/TriG/N-Triples/N-Quads gates                                               |
| `test/w3c/ref-crosscheck.ts`                                            | Allowlisted-divergence audit vs Oxigraph + N3.js                                              |
| `test/w3c/exists-ref.ts`                                                | EXISTS subquery surface vs Oxigraph                                                           |
| `test/w3c/runner.ts`, `manifest.ts`, `divergences.ts`, `rdf-harness.ts` | W3C harness plumbing, manifest parsing, documented divergences                                |
| `test/w3c/fixtures/`                                                    | Vendored W3C suites: `sparql11/`, `sparql12/`, `rdf/` (offline, deterministic)                |

## `bench/`

| File                                       | Role                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `bench/engine_bench.ts`                    | Three-engine benchmark (native / Comunica / Oxigraph) with verification-first equality asserts                             |
| `bench/budget.ts`                          | Regression budget gate (`deno task bench:check`): avg ms/iter against `bench/baseline.json`                                |
| `bench/baseline.json`                      | `maxAllowedMs: 50`, `maxRegressionRatio: 0.15`                                                                             |
| `bench/concurrency-probe.ts`               | EXISTS concurrency stress probe (issue #72): shuffled `Promise.all` rounds + update interleaving, exit 1 on error/mismatch |
| `bench/measure-libs.ts`                    | On-disk footprint of native JSR artifact vs Oxigraph npm vs Comunica transitive closure → `bench/size-data.json`           |
| `bench/collect-memory.ts`                  | Spawns `bench/memory-probe.ts` per engine × workload, merges peak-heap results → `bench/memory-data.json`                  |
| `bench/memory-probe.ts`                    | Peak `heapUsed` per engine (native/Comunica/Oxigraph) on full-scan + nested-EXISTS workloads over a 10k-person graph       |
| `bench/treemap.ts`                         | Renders `bench/*-data.json` into `docs/assets/treemap-{library-size,memory}.svg`                                           |
| `bench/size-data.json`, `memory-data.json` | Measured snapshots consumed by `bench/treemap.ts` and the root `README.md` (Size & memory footprint)                       |

## `docs/` — this wiki ↔ source mapping

| Wiki page                         | Primary sources it documents                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/README.md`                  | Index + Pages setup                                                                |
| `docs/01-quickstart.md`           | `src/mod.ts`, `deno.json` tasks, `README.md`                                       |
| `docs/02-architecture.md`         | `src/wazoo-sparql-engine.ts`, `src/parser/`, `src/evaluator/`, `src/quad-store.ts` |
| `docs/03-api-contracts.md`        | `src/sparql-engine-interface.ts`, `src/wazoo-sparql-engine.ts`, `src/term/`        |
| `docs/04-source-map.md`           | this page — the whole tree                                                         |
| `docs/05-testing.md`              | `test/parity/`, `test/w3c/`, `bench/`, `.github/workflows/ci.yml`                  |
| `docs/06-supplemental-context.md` | `test/w3c/fixtures/`, `CONTEXT.md`, `ARCHITECTURE.md`                              |
| `docs/durable-transactions.md`    | `src/store/sqlite-store.ts` (prototype notes)                                      |

## Where to change what

- **Add an operator/function** → `src/evaluator/expression-evaluator.ts`
  (`evaluateOperation` L262, `evaluateFunctionCall` L1173) + a parity case in
  `test/parity/parity.test.ts`.
- **Add an aggregate** → `src/evaluator/aggregate.ts` (`aggregateValue` L91).
- **Add an update operation** → `src/evaluator/update-evaluator.ts`
  (`applyOperation`).
- **Change the grammar** → `src/parser/sparql.jison`, then
  `deno task parser:generate` (CI enforces sync).
- **Change join/scan semantics** → `src/evaluator/join.ts`, `src/quad-store.ts`.
- **Add a store backend** → implement `rdfjs.Store` (+ `QuadWriteStore` for
  updates, or `createTransaction` for atomic updates).
- **Add a query form** → `src/evaluator/sparql-evaluator.ts` dispatch +
  `src/evaluator/bgp-evaluator.ts` `evaluatePattern` case.

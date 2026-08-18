---
title: Wiki Index
layout: default
---

# [@wazoo/sparql-engine](https://jsr.io/@wazoo/sparql-engine) — Code Wiki

Developer documentation for the Wazoo
[SPARQL 1.1](https://www.w3.org/TR/sparql11-query/) & 1.2 query and update
engine over RDF/JS Quad Stores. This wiki is an application-first tour of the
engine: how queries are parsed, optimized, and evaluated; the public API
contracts; the physical source map; and how to test and benchmark the engine.

The content is verified against the codebase and the `deno doc --json` symbol
inventory of the public surface (`src/mod.ts`). Every file path below is
relative to the repository root.

## Pages

| Page                                                    | What it covers                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [01 — Developer Quickstart](01-quickstart.md)           | Setup, install, running queries, test suites, CI tasks                                                                  |
| [02 — Architecture & Pipeline](02-architecture.md)      | Query lifecycle, algebra, joins, memory model, stores                                                                   |
| [03 — API Contracts](03-api-contracts.md)               | [`SparqlEngineInterface`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlEngineInterface), request/response envelopes, |
|                                                         | feature matrix, extensibility seams                                                                                     |
| [04 — Source Map](04-source-map.md)                     | Directory walkthrough, file → symbol → doc mapping                                                                      |
| [05 — Verification & Testing](05-testing.md)            | Unit/parity/[W3C](https://www.w3.org/) suites, benchmarking, debugging                                                  |
| [06 — Supplemental Context](06-supplemental-context.md) | Datasets, W3C suite notes, divergences, metadata                                                                        |
| [08 — Wiki Maintenance](08-maintenance.md)              | The sync procedure: keep this wiki truthful to `main`                                                                   |

Related in-repo documents:
[ARCHITECTURE.md](https://github.com/wazootech/sparql-engine/blob/main/ARCHITECTURE.md)
(topology and `@worlds/sdk` relationship),
[CONTEXT.md](https://github.com/wazootech/sparql-engine/blob/main/CONTEXT.md)
(glossary), and [`docs/durable-transactions.md`](durable-transactions.md)
(durable SQLite backend — the store moved to `@worlds/sqlite`, pointer kept).

## One-paragraph map

```
SPARQL string
   │  WazooSparqlEngine.execute()            src/wazoo-sparql-engine.ts
   ▼
SparqlParser.parse()                         src/parser/sparql-parser.ts
   │  sparqljs-compatible AST                src/parser/ast.ts
   ▼
SparqlEvaluator.evaluateQuery()              src/evaluator/sparql-evaluator.ts
   │  BgpEvaluator (pattern algebra)         src/evaluator/bgp-evaluator.ts
   │  join.ts (hash joins, property paths)   src/evaluator/join.ts
   │  select-pipeline.ts (group/order/etc.)  src/evaluator/select-pipeline.ts
   ▼
rdfjs.Store (MemoryStore, any external)  src/store/, src/quad-store.ts
```

Updates take a parallel path through `UpdateEvaluator.executeUpdate()`
(`src/evaluator/update-evaluator.ts`) with optional atomic transactions.

## Footprint at a glance

The charts below summarize what the engine costs to ship and run versus the
reference engines. The numbers they plot live in the root `README.md`
(regenerated from `bench/*-data.json`); the methodology is on
[07 — Benchmarking & Performance](07-benchmarking.md):

<figure>
  <img src="assets/chart-library-size.svg" alt="Bar chart of engine footprints on disk">
  <figcaption><b>Fig 1 — Library size on disk.</b> One bar per engine; bar
  length is proportional to total installed size (values in binary MiB, share
  of the combined total in parentheses). Wazoo (green) is a sliver against
  Comunica’s transitive closure (orange); oxigraph (blue) sits between.</figcaption>
</figure>

<figure>
  <img src="assets/treemap-memory.svg" alt="Treemap of peak heap per engine and workload">
  <figcaption><b>Fig 2 — Peak heap during execution</b> (10k-person graph).
  One panel per workload (full scan, nested EXISTS); within each, the three
  engines’ tiles are scaled by their peak `heapUsed`. Wazoo (green) is the
  smallest tile in both panels.</figcaption>
</figure>

**Latency** — average per-query-class latency, lower is better; the committed
chart (full methodology in
[07 — Benchmarking & Performance](07-benchmarking.md), numbers in the root
`README.md`):

<figure>
  <img src="assets/chart-latency.svg" alt="Bar chart of average query latency per query class for wazoo, Comunica, and Oxigraph">
  <figcaption><b>Fig — Query latency by class.</b> One row per query class;
  three bars per row (wazoo green, Comunica orange, Oxigraph blue), bar length
  proportional to average latency within the row — lower is better. Snapshot
  from `bench/latency-data.json`, regenerated by `deno task bench:latency`.</figcaption>
</figure>

## Keeping this wiki in sync

`docs/` is maintained by a **Git-anchored delta process** (the approach
LangChain's OpenWiki uses): `docs/.sync-base` records the last-synced commit,
and syncing means diffing `origin/main` forward from that anchor and editing
only the affected pages — never regenerating. The procedure — structure verified
from `git ls-tree` and `deno doc --json`; this wiki uses the drift-free
`detail_level: minimal` style, so no line numbers or counts — is codified as the
`wiki-sync` skill and documented on [08 — Wiki Maintenance](08-maintenance.md).
If you land a source change, sync the wiki the same way — it is a command, not a
prompt.

## GitHub Pages setup

The `docs/` directory is the GitHub Pages content root. To publish:

1. Repo **Settings → Pages**.
2. **Source**: _Deploy from a branch_.
3. **Branch**: `main`, **folder**: `/docs`.
4. Save. GitHub Pages builds the markdown with Jekyll; this `README.md` is the
   landing page and the `0X-*.md` pages are linked from it.

No workflow file is required for this mode. (The alternative — the
`actions/deploy-pages` workflow — also works; point its artifact at `docs/`.)
Pages picks up changes on every push to `main`.

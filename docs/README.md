---
title: Wiki Index
layout: default
---

# @wazoo/sparql-engine — Code Wiki

Developer documentation for the Wazoo-native SPARQL 1.1 & 1.2 query and update
engine over RDF/JS Quad Stores. This wiki is an application-first tour of the
engine: how queries are parsed, optimized, and evaluated; the public API
contracts; the physical source map; and how to test and benchmark the engine.

The content is verified against the codebase and the `deno doc --json` symbol
inventory of the public surface (`src/mod.ts`). Every file path below is
relative to the repository root.

## Pages

| Page                                                    | What it covers                                         |
| ------------------------------------------------------- | ------------------------------------------------------ |
| [01 — Developer Quickstart](01-quickstart.md)           | Setup, install, running queries, test suites, CI tasks |
| [02 — Architecture & Pipeline](02-architecture.md)      | Query lifecycle, algebra, joins, memory model, stores  |
| [03 — API Contracts](03-api-contracts.md)               | `SparqlEngineInterface`, request/response envelopes,   |
|                                                         | feature matrix, extensibility seams                    |
| [04 — Source Map](04-source-map.md)                     | Directory walkthrough, file → symbol → doc mapping     |
| [05 — Verification & Testing](05-testing.md)            | Unit/parity/W3C suites, benchmarking, debugging        |
| [06 — Supplemental Context](06-supplemental-context.md) | Datasets, W3C suite notes, divergences, metadata       |
| [08 — Wiki Maintenance](08-maintenance.md)              | The sync procedure: keep this wiki truthful to `main`  |

Related in-repo documents: [ARCHITECTURE.md](../ARCHITECTURE.md) (topology and
`@worlds/client` relationship), [CONTEXT.md](../CONTEXT.md) (glossary), and
[`docs/durable-transactions.md`](durable-transactions.md) (SQLite transaction
backend prototype).

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
rdfjs.Store (MemoryStore, SqliteStore, any)  src/store/, src/quad-store.ts
```

Updates take a parallel path through `UpdateEvaluator.executeUpdate()`
(`src/evaluator/update-evaluator.ts`) with optional atomic transactions.

## Footprint at a glance

Three figures summarize what the engine costs to ship and run versus the
reference engines (bar length is proportional to size; full methodology and
tables in [07 — Benchmarking & Performance](07-benchmarking.md)):

|                          | native                     | oxigraph | comunica                |
| ------------------------ | -------------------------- | -------- | ----------------------- |
| on-disk footprint        | **0.60 MiB** (zero deps)   | 7.9 MiB  | 28.3 MiB (368 packages) |
| smallest subpath import  | **7.4 KiB** (`/serialize`) | —        | —                       |
| peak heap, full scan     | **134 MiB**                | 251 MiB  | 214 MiB                 |
| peak heap, nested EXISTS | **82 MiB**                 | 108 MiB  | 271 MiB                 |

<figure>
  <img src="assets/chart-library-size.svg" alt="Bar chart of engine footprints on disk">
  <figcaption><b>Fig 1 — Library size on disk.</b> One bar per engine; bar
  length is proportional to total installed size (values in binary MiB, share
  of the combined total in parentheses). Native (green) is the whole JSR
  artifact at 0.60 MiB — a sliver against comunica’s 28.3 MiB closure (orange);
  oxigraph (blue) sits between.</figcaption>
</figure>

<figure>
  <img src="assets/treemap-memory.svg" alt="Treemap of peak heap per engine and workload">
  <figcaption><b>Fig 2 — Peak heap during execution</b> (10k-person graph).
  One panel per workload (full scan, nested EXISTS); within each, the three
  engines’ tiles are scaled by their peak `heapUsed` (values in MiB). Native
  (green) is the smallest tile in both panels.</figcaption>
</figure>

## Keeping this wiki in sync

`docs/` is maintained by a **Git-anchored delta process** (the approach
LangChain's OpenWiki uses): `docs/.sync-base` records the last-synced commit,
and syncing means diffing `origin/main` forward from that anchor and editing
only the affected pages — never regenerating. The procedure (symbol lines from
`deno doc --json`, counts from the runners, inventory from `git ls-tree`) is
codified as the `wiki-sync` skill and documented on
[08 — Wiki Maintenance](08-maintenance.md). If you land a source change, sync
the wiki the same way — it is a command, not a prompt.

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

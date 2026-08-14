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

---
title: Developer Quickstart
layout: default
---

# Developer Quickstart

Get the engine running, execute SPARQL against a store, and run the test suites
— in about five minutes.

> **Try it without installing anything:** the
> [**Wazoo SPARQL Playground**](https://wazootech.github.io/sparql-engine/playground/)
> runs the engine in your browser over sample datasets — no setup, and every
> query you run is shareable via its URL.

## Environment

The project is a **Bun** package published to
[JSR](https://jsr.io/@wazoo/sparql-engine). Install [Bun](https://bun.sh)
(1.4.5 or newer: `bun fmt` and `bun check` need it), then:

```bash
bun install
```

`jsr.json` is the published package's manifest and `package.json` /
`bun.lock` are what Bun installs; `bun run check:manifests` keeps the two in
step. `pnpm`/`npm`/`yarn` are **not** used by this repository.

## Install the package

From a Deno, Bun or Node project (or the browser via esm.sh):

```bash
# Deno
deno add jsr:@wazoo/sparql-engine

# Bun
bunx jsr add @wazoo/sparql-engine

# Node.js / npm
npx jsr add @wazoo/sparql-engine
```

```typescript
// mod.ts — package entry point (src/mod.ts in this repo)
import {
  DataFactory,
  MemoryStore,
  WazooSparqlEngine,
} from "@wazoo/sparql-engine";
```

Or import the local checkout directly while developing:

```typescript
import { WazooSparqlEngine } from "./src/mod.ts";
```

## Run a SPARQL query

The engine is a library, not a daemon: `execute()` is the whole surface. Seed a
store, build the engine, fire a query:

```typescript
// query.ts
import { DataFactory, MemoryStore, WazooSparqlEngine } from "./src/mod.ts";

const { namedNode, literal, quad } = DataFactory;
const store = new MemoryStore();
store.addQuad(
  quad(
    namedNode("https://example.org/alice"),
    namedNode("https://xmlns.com/foaf/0.1/name"),
    literal("Alice"),
  ),
);

const engine = new WazooSparqlEngine({ store });

const result = await engine.execute({
  query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
});
if (result.kind === "select") {
  console.log(result.data.results.bindings);
}
```

```bash
bun query.ts
```

There is no CLI binary and no dev server in this repository — the distribution
surface is the programmatic API. For quick REPL-style checks, `bun -e` is the
CLI:

```bash
bun -e '
import { DataFactory, MemoryStore, WazooSparqlEngine } from "./src/mod.ts";
const { namedNode, literal, quad } = DataFactory;
const store = new MemoryStore();
store.addQuad(quad(namedNode("https://example.org/alice"),
  namedNode("https://xmlns.com/foaf/0.1/name"), literal("Alice")));
const engine = new WazooSparqlEngine({ store });
const r = await engine.execute({ query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }" });
console.log(JSON.stringify(r.kind === "select" ? r.data.results.bindings : r));
'
```

Prints:

```json
[
  {
    "s": { "type": "uri", "value": "https://example.org/alice" },
    "p": { "type": "uri", "value": "https://xmlns.com/foaf/0.1/name" },
    "o": { "type": "literal", "value": "Alice" }
  }
]
```

### ASK, CONSTRUCT, and UPDATE in the same loop

```typescript
const ask = await engine.execute({
  query:
    "ASK { <https://example.org/alice> <https://xmlns.com/foaf/0.1/name> ?o }",
}); // { kind: "ask", data: { boolean: true } }

const graph = await engine.execute({
  query:
    "CONSTRUCT { ?s <https://example.org/label> ?o } WHERE { ?s <https://xmlns.com/foaf/0.1/name> ?o }",
}); // { kind: "construct", data: { quads: [...] } }

const patch = await engine.execute({
  query:
    'INSERT DATA { <https://example.org/bob> <https://xmlns.com/foaf/0.1/name> "Bob" }',
}); // { kind: "void" } — SPARQL updates return void
```

## Verify and build

```bash
bun run fmt:check      # formatting gate (bun fmt --check)
bun run lint           # Oxlint
bun run check          # typecheck (bun check)
bun run check:manifests # jsr.json and package.json agree on exports and deps
bun run parser:check   # generated parser.ts in sync with sparql.jison?
bun run publish:check # default graph has no node:/npm: runtime imports
bun run publish:dry  # JSR publish dry-run (zero runtime deps must hold)
```

`bun run ci` runs all of the above plus every test gate — see
[05 — Verification & Testing](05-testing.md) for the full task table.

## Run the test suites

```bash
bun run test         # unit + integration + parity tests (bun test --timeout 120000)
bun run test:w3c     # W3C SPARQL 1.1 evaluation-core, differential vs Comunica
bun run test:sparql12    # W3C SPARQL 1.2 evaluation suite
bun run test:sparql12:gap # RDF 1.2 eval-triple-terms gap suite
bun run test:rdf11   # RDF 1.1 Turtle/TriG/N-Triples/N-Quads syntax gate
bun run test:rdf12   # RDF 1.2 triple-term/reifier syntax gate
bun run test:exists-ref # EXISTS subquery surface vs Oxigraph
bun run test:ref     # allowlisted-divergence audit vs Oxigraph + N3.js
```

`bun test` needs no network for the [W3C](https://www.w3.org/) suites: fixtures
are vendored under `test/w3c/fixtures/`.

## Benchmarks

```bash
bun run bench        # wazoo vs Comunica vs Oxigraph, verification-first
bun run bench:check  # regression budget gate (bench/budget.ts)
bun run bench:size   # on-disk library footprint → docs/assets/chart-library-size.svg
bun run bench:size:closures # per-entrypoint import closure → docs/assets/chart-closures.svg
bun run bench:memory # peak memory per engine → docs/assets/treemap-memory.svg
bun run bench:latency # committed latency snapshot → docs/assets/chart-latency.svg
```

## Development loop

```bash
bun run fmt            # format source AND markdown (bun fmt, line width 80)
bun test src/          # fast unit loop for engine internals
```

If you change `src/parser/sparql.jison`, regenerate the parser and keep it in
sync (CI fails otherwise):

```bash
bun run parser:generate
```

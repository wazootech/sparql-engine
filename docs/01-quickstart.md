---
title: Developer Quickstart
layout: default
---

# Developer Quickstart

Get the engine running, execute SPARQL against a store, and run the test suites
— in about five minutes.

## Environment

The project is a **Deno 2.x** package published to
[JSR](https://jsr.io/@wazoo/sparql-engine). Install Deno:

```bash
curl -fsSL https://deno.land/install.sh | sh   # macOS / Linux
# Windows (PowerShell): irm https://deno.land/install.ps1 | iex
```

There is no Node build step and no package manager needed for development:
`deno.json` at the repo root is the entire build config. `pnpm`/`npm`/`yarn` are
**not** used by this repository — do not add a `package.json` or run
`npm install`.

## Install the package

From any Deno project (or `deno jupyter`, `deno repl`, browser via esm.sh):

```bash
# Deno
deno add jsr:@wazoo/sparql-engine

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
deno run query.ts
```

There is no CLI binary and no dev server in this repository — the distribution
surface is the programmatic API. For quick REPL-style checks, `deno eval` is the
CLI:

```bash
deno eval '
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
[{
  "s": { "type": "uri", "value": "https://example.org/alice" },
  "p": { "type": "uri", "value": "https://xmlns.com/foaf/0.1/name" },
  "o": { "type": "literal", "value": "Alice" }
}]
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
  update:
    'INSERT DATA { <https://example.org/bob> <https://xmlns.com/foaf/0.1/name> "Bob" }',
}); // { kind: "void" } — SPARQL updates return void
```

## Verify and build

```bash
deno task check        # typecheck the whole package (deno check)
deno task fmt:check    # formatting gate (deno fmt --check)
deno task lint         # deno lint
deno task parser:check # generated parser.ts in sync with sparql.jison?
deno task publish:dry  # JSR publish dry-run (zero runtime deps must hold)
```

`deno task ci` runs all of the above plus every test gate — see
[05 — Verification & Testing](05-testing.md) for the full task table.

## Run the test suites

```bash
deno task test         # unit + integration + parity tests (deno test --allow-all)
deno task test:w3c     # W3C SPARQL 1.1 evaluation-core, differential vs Comunica
deno task test:sparql12    # W3C SPARQL 1.2 evaluation suite
deno task test:sparql12:gap # RDF 1.2 eval-triple-terms gap suite
deno task test:rdf11   # RDF 1.1 Turtle/TriG/N-Triples/N-Quads syntax gate
deno task test:rdf12   # RDF 1.2 triple-term/reifier syntax gate
deno task test:exists-ref # EXISTS subquery surface vs Oxigraph
deno task test:ref     # allowlisted-divergence audit vs Oxigraph + N3.js
```

`deno test` needs no network for the W3C suites: fixtures are vendored under
`test/w3c/fixtures/`.

## Benchmarks

```bash
deno task bench        # wazoo vs Comunica vs Oxigraph, verification-first
deno task bench:check  # regression budget gate (bench/budget.ts)
deno task bench:size   # on-disk library footprint → docs/assets/chart-library-size.svg
deno task bench:size:closures # per-entrypoint import closure → docs/assets/chart-closures.svg
deno task bench:memory # peak heap per engine → docs/assets/treemap-memory.svg
```

## Development loop

```bash
deno task fmt          # format source AND markdown (line width 80)
deno test src/         # fast unit loop for engine internals
```

If you change `src/parser/sparql.jison`, regenerate the parser and keep it in
sync (CI fails otherwise):

```bash
deno task parser:generate
```

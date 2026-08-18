# Architecture

## Topology

`@wazoo/sparql-engine` is a standalone, lightweight SPARQL 1.1 & 1.2 query and
update engine for RDF/JS Quad Stores (`rdfjs.Store`).

```text
[ SPARQL Query String ] 
         │
         ▼
 ┌──────────────┐
 │  Parser      │ (in-repo sparqljs grammar + generated parser)
 └───────┬──────┘
         │
         ▼
 ┌──────────────┐
 │  Evaluator   │ (BGP matching, FILTER, OPTIONAL, UNION, Aggregates)
 └───────┬──────┘
         │
         ▼
 ┌──────────────┐
 │ rdfjs.Store  │ (MemoryStore, or any external rdfjs.Store)
 └──────────────┘
```

In-repo store implementation is `MemoryStore` (in-memory, the default). The
durable `node:sqlite` store that used to ship behind the `./sqlite` subpath
moved to `@worlds/sqlite` (2026-08-17), packaged with the worlds impl — see
[`SqliteStore`](https://github.com/wazootech/worlds-sqlite/blob/main/src/sqlite/rdfjs-store/sqlite-store.ts).
Any external `rdfjs.Store` works — e.g. `@worlds/sqlite`'s `SqliteStore`, or
`@worlds/libsql`'s `LibsqlRdfjsStore` / `@worlds/denokv`'s `DenokvRdfjsStore`.

## Contracts

- `SparqlEngineInterface`: SPARQL engine execution interface, duplicated
  identically from `@worlds/sdk` (see Relationship to @worlds/sdk).
- `SparqlRequest` / `SparqlResponse`: Strongly typed request and response
  envelopes (`select`, `ask`, `construct`, `void`).
- `WazooSparqlTransaction`: Structural interface for atomic SPARQL `UPDATE`
  mutations.

## Relationship to @worlds/sdk

`WazooSparqlEngine` implements `SparqlEngineInterface`, the same contract
`@worlds/sdk`'s durable client factories (`createLibsqlClient`,
`createDenokvClient`, `createSqliteClient`) wire into every `Sdk`. The former
`@worlds/client` `ComunicaSparqlEngine` adapter (which this engine used to
mirror as a drop-in replacement) was removed from the SDK on 2026-08-17; the
wazoo engine is now the only shipped engine. `WazooSparqlTransaction` mirrors
the structural shape of `@worlds/sdk`'s `Transaction`, so durable backends can
pass their existing transaction objects.

The interface is intentionally duplicated in `@worlds/sdk` under an
identical-spec policy: the two copies must stay identical (gated by
`deno task interface-parity`). Behavioral deltas vs the retired adapter:
`ComunicaSparqlEngine` enforced `timeoutMs` and accepted a request-level
`baseIri`; the wazoo engine honors request `baseIri` (the query's `BASE`
directive wins when both are present — decision #117, Fork B) and does not yet
enforce a timeout (tracked in #122). Keep these differences in mind when
swapping engines.

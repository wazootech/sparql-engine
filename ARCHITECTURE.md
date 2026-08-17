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
`@worlds/client`'s `LibsqlRdfjsStore` / `DenokvRdfjsStore`.

## Contracts

- `SparqlEngineInterface`: SPARQL engine execution interface, duplicated
  identically from `@worlds/client` (see Relationship to @worlds/client).
- `SparqlRequest` / `SparqlResponse`: Strongly typed request and response
  envelopes (`select`, `ask`, `construct`, `void`).
- `WazooSparqlTransaction`: Structural interface for atomic SPARQL `UPDATE`
  mutations.

## Relationship to @worlds/client

`WazooSparqlEngine` implements the same `SparqlEngineInterface` as
`ComunicaSparqlEngine` in `@worlds/client` (`@worlds/client/comunica`), so it is
a drop-in replacement: swap the `sparqlEngine` passed to a `Client` without
changing client code. `WazooSparqlTransaction` mirrors the structural shape of
`@worlds/client`'s `Transaction`, so durable backends can pass their existing
transaction objects.

The interface is intentionally duplicated in both packages under an
identical-spec policy: the two copies must stay identical. Behavioral deltas
today: `ComunicaSparqlEngine` enforces `timeoutMs` and accepts a request-level
`baseIri`; the wazoo engine now also honors request `baseIri` (the query's
`BASE` directive wins when both are present — decision #117, Fork B) and does
not yet enforce a timeout (tracked in #122). Keep these differences in mind when
swapping engines.

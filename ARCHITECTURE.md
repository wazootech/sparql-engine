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
 │ rdfjs.Store  │ (MemoryStore, SqliteStore, or any external rdfjs.Store)
 └──────────────┘
```

In-repo store implementations are `MemoryStore` (in-memory, the default) and
`SqliteStore` (durable prototype over `node:sqlite`; deep-import only, not part
of the public export graph). Any external `rdfjs.Store` also works — e.g.
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
`baseIri`, while the wazoo engine derives the base IRI from the query's `BASE`
directive and does not yet enforce a timeout. Keep these differences in mind
when swapping engines.

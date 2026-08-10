# Architecture

## Topology

`@wazoo/sparql-engine` is a standalone, lightweight SPARQL 1.1 query and update
engine for RDF/JS Quad Stores (`rdfjs.Store`).

```text
[ SPARQL Query String ] 
         │
         ▼
 ┌──────────────┐
 │  Parser      │ (sparqljs AST parsing)
 └───────┬──────┘
         │
         ▼
 ┌──────────────┐
 │  Evaluator   │ (BGP matching, FILTER, OPTIONAL, UNION, Aggregates)
 └───────┬──────┘
         │
         ▼
 ┌──────────────┐
 │ rdfjs.Store  │ (In-memory N3.Store, LibsqlRdfjsStore, DenokvRdfjsStore)
 └──────────────┘
```

## Contracts

- `SparqlEngineInterface`: Canonical Wazoo SPARQL engine execution interface.
- `SparqlRequest` / `SparqlResponse`: Strongly typed request and response
  envelopes (`select`, `ask`, `construct`, `void`).
- `NativeSparqlTransaction`: Structural interface for atomic SPARQL `UPDATE`
  mutations.

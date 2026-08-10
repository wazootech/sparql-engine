# @wazoo/sparql-engine

Wazoo-native SPARQL 1.1 Query & Update Engine over RDF/JS Quad Stores.

## Key capabilities

- **SPARQL 1.1 Query Engine**: Native evaluation of `SELECT`, `ASK`,
  `CONSTRUCT`, and `DESCRIBE` queries over `rdfjs.Store` sources.
- **SPARQL 1.1 Update Engine**: Support for `INSERT DATA`, `DELETE DATA`,
  `DELETE/INSERT`, and atomic patch transactions.
- **Zero Heavy Dependencies**: Lightweight AST parsing via `sparqljs` without
  Comunica framework overhead.
- **JSR & Deno Native**: Published on JSR as `@wazoo/sparql-engine` for Deno,
  Node.js, and browser environments.

## Usage

```typescript
import { NativeSparqlEngine } from "@wazoo/sparql-engine";
import { DataFactory, Store } from "n3";

const store = new Store();
const engine = new NativeSparqlEngine({ store });

const result = await engine.execute({
  query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
});

if (result.kind === "select") {
  console.log(result.data.results.bindings);
}
```

## Development

```bash
deno task ci
```

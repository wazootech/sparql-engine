# @wazoo/sparql-engine

Wazoo-native SPARQL 1.1 & 1.2 Query & Update Engine over RDF/JS Quad Stores.

## Key capabilities

- **SPARQL 1.1 & 1.2 Query Engine**: Native evaluation of `SELECT`, `ASK`,
  `CONSTRUCT`, and `DESCRIBE` queries over `rdfjs.Store` sources — including
  SPARQL 1.2 direction functions (`LANGDIR`, `STRLANGDIR`, `hasLang`,
  `hasLangDir`) and RDF 1.2 reified triple terms (`<< s p o >>`).
- **SPARQL 1.1 & 1.2 Update Engine**: Support for `INSERT DATA`, `DELETE DATA`,
  `DELETE/INSERT`, `LOAD`, and atomic patch transactions, including updates over
  reified triple terms.
- **W3C SPARQL 1.2 Gate**: CI runs the W3C SPARQL 1.2 evaluation suite
  differentially against Comunica — currently **249/249** pass — plus **41/41**
  on the RDF 1.2 eval-triple-terms gap suite.
- **Zero Runtime Dependencies**: Lightweight AST parsing via the in-repo SPARQL
  parser (a maintained sparqljs 3.7.4 grammar), plus an in-repo jison
  Turtle/TriG/N-Triples/N-Quads parser backing `LOAD` (including RDF 1.2 triple
  terms, reifiers, and annotations); zero runtime dependencies (only type-only
  `@rdfjs/types`), and no Comunica framework overhead — browser-friendly and
  JSR-ready without transitive npm baggage.
- **JSR & Deno Native**: Published on JSR as `@wazoo/sparql-engine` for Deno,
  Node.js, and browser environments.
- **Drop-in for `@worlds/client`**: Implements the same `SparqlEngineInterface`
  as `ComunicaSparqlEngine` (`@worlds/client/comunica`), so it can be swapped
  into a `Client` without client changes.

## Usage

```typescript
import {
  DataFactory,
  MemoryStore,
  WazooSparqlEngine,
} from "@wazoo/sparql-engine";

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

## Parity testing

The differential test suite in `test/parity/` proves behavioral equivalence with
`@comunica/query-sparql-rdfjs-lite`, the engine this project ports 1:1. Every
case seeds both engines with identical RDF/JS stores, runs the same query
through each, and deep-compares the observable results: SELECT bindings
(projected variables and values, with ORDER BY emission order compared exactly),
ASK booleans, and CONSTRUCT quads.

Blank nodes are compared by identity, not by label. Comunica skolemizes blank
nodes from query sources into prefixed labels (`bc_<sourceId>_<label>`); the
native engine returns the store's own labels. SPARQL 1.1 result semantics treat
blank node labels as scoped and opaque, so the native engine deliberately does
not replicate the prefix — the harness strips it from Comunica's output before
comparing (see `test/parity/parity-harness.ts`). A test in
`test/parity/parity.test.ts` locks in this known difference against real
Comunica output, so the normalization stays verified rather than assumed.

SPARQL updates are covered the same way in `test/parity/parity-update.test.ts`:
INSERT DATA, DELETE DATA, INSERT WHERE, DELETE WHERE, and DELETE/INSERT (plain,
typed, and language-tagged literals, fresh blank nodes per solution, named graph
templates, joins in WHERE, and composite requests) run against both engines on
identical seed stores, and the final store contents are compared. Because INSERT
DATA mints fresh blank node labels per execution (`e_<label>NN` under Comunica,
`u<N>` natively), the harness canonicalizes store contents up to blank node
relabeling — two stores pass when they agree exactly modulo label identity,
which is the SPARQL contract.

## Benchmarking

`bench/engine_bench.ts` compares query and update execution against both
`@comunica/query-sparql-rdfjs-lite` and the Oxigraph WASM engine (`oxigraph`)
over an identical generated graph. Before timing, every run asserts that all
three engines return identical results for each query, and for updates asserts
that they produce identical final store contents after mutating fresh stores (a
move update, which a broken engine that ignores updates cannot pass). The timed
update is a self-restoring delete+insert rewrite, so iterations never drift the
benchmark stores. The reorder-chain group demonstrates the dynamic join
ordering: a three-pattern chain written in worst-case order runs ~90x faster
with reordering enabled, because the planner scans each pattern once and joins
in order of estimated cost, preferring patterns whose variables are already
bound. Timings use Deno's built-in bench runner with the native engine as the
per-group baseline:

```bash
deno task bench
```

### Results

A snapshot measured on a Windows desktop with Deno 2.9.5 (native engine as
the per-group baseline). Each cell is the per-iteration average; every query
is cross-verified to return identical results on all three engines before
timing. Timings are machine-specific — run `deno task bench` for your own
numbers.

Core joins, 400-person graph (~2,200 quads):

| query | native | comunica | oxigraph |
| --- | --- | --- | --- |
| full scan | 1.3 ms | 7.6 ms | 12.2 ms |
| join (knows × name) | 1.0 ms | 5.2 ms | 2.6 ms |
| asymmetric join | 1.4 ms | 29.2 ms | 15.1 ms |
| reorder chain, written order | 136.5 ms | 193.2 ms | 3.2 ms |
| reorder chain, planner on | 1.5 ms | — | — |

EXISTS surface, 400-person graph:

| query | native | comunica | oxigraph |
| --- | --- | --- | --- |
| `FILTER EXISTS` | 0.81 ms | 29.2 ms | 1.0 ms |
| `FILTER NOT EXISTS` | 0.88 ms | 33.3 ms | 1.3 ms |
| nested `EXISTS` | 1.1 ms | 134.6 ms | 1.3 ms |
| nested `NOT EXISTS` | 1.1 ms | 134.1 ms | 1.2 ms |

EXISTS surface, 10,000-person graph (~55,000 quads):

| query | native | comunica | oxigraph |
| --- | --- | --- | --- |
| `FILTER EXISTS` | 27.8 ms | 729.5 ms | 27.0 ms |
| `FILTER NOT EXISTS` | 26.8 ms | 835.9 ms | 30.7 ms |
| nested `EXISTS` | 41.3 ms | 3.1 s | 43.3 ms |
| nested `NOT EXISTS` | 39.6 ms | 3.2 s | 32.3 ms |

Scaling the data 25x (400 → 10,000 people) grows native's EXISTS cost
~35-40x while the nested-vs-simple ratio *shrinks* (1.45x → 1.12x): the
snapshot is drained and indexed once per query, and each probe touches only
its candidate bucket, so nesting stays cheap relative to the dataset. Across
the exists surface native is 20-180x faster than comunica and roughly at
parity with oxigraph (a compiled Rust/WASM engine with native indexes, which
remains ahead on the reorder-chain row); on the core scan/join rows native is
the fastest of the three.

## Development

```bash
deno task ci
```

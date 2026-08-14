---
title: 02 — System Architecture & Query Pipeline
layout: default
---

# 02 — System Architecture & Query Pipeline

This page traces a SPARQL query end-to-end: string → AST → algebra →
optimization → evaluation → result set, with the concrete files and methods that
implement each stage, the memory model, and how the engine binds to storage
backends.

## The pipeline at a glance

```
SPARQL string (request.query)
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│ WazooSparqlEngine.execute()   src/wazoo-sparql-engine.ts L55  │
│   raw = request.query ?? request.update                        │
│   ast  = parser.parse(raw)                                     │
│   update? → UpdateEvaluator.executeUpdate(ast)   → {kind:"void"}│
│   query?  → SparqlEvaluator.evaluateQuery(ast)  → typed result │
└───────────────┬───────────────────────────────────────────────┘
                ▼
┌───────────────────────────────────────────────────────────────┐
│ SparqlParser.parse()  src/parser/sparql-parser.ts L9          │
│   vendored sparqljs 3.7.4 jison grammar + SPARQL 1.2 patches  │
│   (src/parser/sparql.jison → generated src/parser/parser.ts)  │
│   produces the sparqljs-compatible AST (src/parser/ast.ts)    │
└───────────────┬───────────────────────────────────────────────┘
                ▼
┌───────────────────────────────────────────────────────────────┐
│ SparqlEvaluator.evaluateQuery()  src/evaluator/sparql-evaluator.ts │
│   SELECT → evaluateSelect → evaluateSelectTermBindings         │
│   ASK    → evaluateAsk        (bindings.length > 0)            │
│   CONSTRUCT → evaluateConstruct (template × bindings)          │
│   DESCRIBE  → evaluateDescribe (outgoing arcs of resources)    │
└───────────────┬───────────────────────────────────────────────┘
                ▼
┌───────────────────────────────────────────────────────────────┐
│ BgpEvaluator.evaluateBgp()  src/evaluator/bgp-evaluator.ts    │
│   resolve EXISTS snapshot  (when EXISTS/NOT EXISTS present)   │
│   evaluateGroup(): walk patterns, thread solution bindings    │
│     bgp      → joinBgp()   → scanEntry / joinTriplePattern    │
│     path     → scanPathEntry / joinPathPattern                │
│     filter   → ExpressionEvaluator.filterPasses()             │
│     optional → leftJoin()  (FILTERs hoisted as join filters)  │
│     minus    → minus()     (shared-variable anti-join)        │
│     union    → innerJoin() with branch results                │
│     graph    → GraphScopedStore view, recursive group eval    │
│     bind     → Extend (per-solution expression extend)        │
│     values   → innerJoin() with the data block                │
│     query    → fresh SparqlEvaluator, innerJoin() the results │
└───────────────┬───────────────────────────────────────────────┘
                ▼
┌───────────────────────────────────────────────────────────────┐
│ applySelectPipeline()  src/evaluator/select-pipeline.ts       │
│   VALUES join → GROUP BY/aggregates → HAVING → ORDER BY →     │
│   projection → DISTINCT/REDUCED → OFFSET → LIMIT              │
└───────────────┬───────────────────────────────────────────────┘
                ▼
┌───────────────────────────────────────────────────────────────┐
│ rdfTermToSparqlValue()  src/term/convert.ts L44               │
│   TermBinding (RDF/JS terms) → SparqlValue wire format        │
│   (uri / bnode / literal / triple)                            │
└───────────────┬───────────────────────────────────────────────┘
                ▼
  SparqlResponse  {kind:"select"|"ask"|"construct"|"void"}
```

## Stage 1 — Parse (string → AST)

`WazooSparqlEngine.execute()` (`src/wazoo-sparql-engine.ts`) calls
`SparqlParser.parse()` (`src/parser/sparql-parser.ts`), which wraps `Parser`
(`src/parser/mod.ts`) over the **generated** jison parser
(`src/parser/parser.ts`, generated from `src/parser/sparql.jison`).

The grammar is sparqljs 3.7.4's, vendored and patched in-repo with the SPARQL
1.2 surface: the four direction functions (`LANGDIR`, `STRLANGDIR`, `hasLang`,
`hasLangDir`) and RDF 1.2 triple-term/reifier/annotation syntax
(`<<( s p o )>>`, `<< s p o ~ r >>`, `{| ... |}`). Details and the exact lexer
patch are in `src/parser/README.md`.

The AST (`src/parser/ast.ts`) is **sparqljs-shaped**, so the parser is a drop-in
replacement for the `sparqljs` export. `SparqlQuery` is a union of `Query`
(SELECT/ASK/CONSTRUCT/DESCRIBE) and `UpdateQuery`.

Example — parsing a query in one line:

```bash
deno eval '
import { SparqlParser } from "./src/parser/sparql-parser.ts";
const ast = new SparqlParser().parse(
  "SELECT ?name WHERE { ?s <https://xmlns.com/foaf/0.1/name> ?name FILTER(?name != \"\") }"
);
console.log(JSON.stringify(ast, null, 2));
'
```

```json
{
  "queryType": "SELECT",
  "variables": [{ "value": "name", "termType": "Variable" }],
  "where": [
    {
      "type": "bgp",
      "triples": [
        {
          "subject": { "value": "s", "termType": "Variable" },
          "predicate": {
            "value": "https://xmlns.com/foaf/0.1/name",
            "termType": "NamedNode"
          },
          "object": { "value": "name", "termType": "Variable" }
        }
      ]
    },
    {
      "type": "filter",
      "expression": {
        "type": "operation",
        "operator": "!=",
        "args": [
          { "value": "name", "termType": "Variable" },
          {
            "value": "",
            "termType": "Literal",
            "language": "",
            "direction": "",
            "datatype": {
              "value": "http://www.w3.org/2001/XMLSchema#string",
              "termType": "NamedNode"
            }
          }
        ]
      }
    }
  ],
  "type": "query",
  "prefixes": {}
}
```

## Stage 2 — Algebra (AST → pattern evaluation)

There is no separate algebra IR: the sparqljs AST **is** the algebra, and the
translation to SPARQL 1.1 algebra operators happens inside
`BgpEvaluator.evaluatePattern()` (`src/evaluator/bgp-evaluator.ts`). The code
comments cite the spec section for each mapping:

| AST pattern (`type`) | Algebra operator (SPARQL 1.1 §18.2)               | Code                                              |
| -------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `bgp`                | Join over triple patterns (hash join)             | `joinTriplePattern`, `src/evaluator/join.ts` L213 |
| `filter`             | Filter                                            | `ExpressionEvaluator.filterPasses()`              |
| `bind`               | Extend(P, var, expr) — §18.2.2.2                  | `evaluatePattern` `"bind"` case                   |
| `values`             | Join(P, Values(...)) — multiset natural join      | `innerJoin`                                       |
| `optional`           | LeftJoin(P1, P2, F) — FILTERs hoisted to the join | `leftJoin`, `src/evaluator/join.ts` L78           |
| `minus`              | Minus — §18.2.2.9, shared-variable anti-join      | `minus`, `src/evaluator/join.ts` L131             |
| `union`              | Join(P, Union(Q1, Q2))                            | `innerJoin` over branch results                   |
| `graph`              | Graph-scoped evaluation over a `GraphScopedStore` | `src/quad-store.ts` L134                          |
| `query` (subquery)   | Evaluated first, then joined — §18.2.4            | fresh `SparqlEvaluator` + `innerJoin`             |
| `service`            | Evaluated locally (SILENT swallows errors)        | `"service"` case                                  |
| `group`              | Nested group → Join with the outer solutions      | recursive `evaluateGroup`                         |

### The SELECT pipeline as algebra

The post-WHERE stages live in one synchronous function, `applySelectPipeline()`
(`src/evaluator/select-pipeline.ts` L57), which is shared verbatim by the async
main path and the synchronous EXISTS subquery path:

```
raw bindings
  → Join(P, Values)          (query.values)
  → Group / Aggregate        (GROUP BY + COUNT/SUM/AVG/MIN/MAX/SAMPLE/GROUP_CONCAT)
  → Having                   (filter groups by EBV with aggregate resolution)
  → OrderBy                  (compareRdfTerms, stable sort)
  → Project                  (vars + AS ?v expressions, BNODE cache per solution)
  → Distinct / Reduced       (REDUCED ≡ DISTINCT by decision)
  → Slice                    (OFFSET, LIMIT)
```

## Stage 3 — Optimize (join ordering)

Pattern reordering is **on by default** (`reorderPatterns: true`) and is the
engine's optimizer. It is a _dynamic_ greedy planner, not a static rewrite:

1. `joinBgp()` (`bgp-evaluator.ts`) expands reified patterns and, when the block
   has more than one pattern and no property paths, calls
   `evaluateWithReordering()`.
2. `evaluateWithReordering()` scans **every** pattern exactly once up front via
   `scanEntry()` — so the planner uses the pattern's _true_ store cardinality
   (`entry.candidates.length`), never a heuristic estimate.
3. A greedy loop repeatedly joins the remaining pattern with the lowest
   `estimateJoinCost()` against the current bindings:
   - no pattern variable bound → `bindings.length × candidates.length`;
   - a pattern variable bound in the incoming solutions → the positional index
     is probed, costing `bindings.length × average bucket size`
     (`candidates.length ÷ distinct bound values`).

This is what makes the benchmark `chainQuery` ~32× faster with reordering
enabled: a three-pattern chain written in worst-case order collapses a 400×400
intermediate to 400 (see `bench/engine_bench.ts`, group `reorder-chain`).
Setting `reorderPatterns: false` in `WazooSparqlEngineOptions` preserves written
order exactly.

## Stage 4 — Execute (storage scans & joins)

### Store binding

The engine never owns data. It binds to any `rdfjs.Source` / `rdfjs.Store`:

- `src/store/memory-store.ts` — `MemoryStore`, the default in-memory store (a
  `Map` keyed by a four-position `quadKey`), plus `MemoryStream`, a
  zero-dependency RDF/JS `Stream` implementation (flow + pull modes).
- `src/store/sqlite-store.ts` — durable `SqliteStore` over `node:sqlite`,
  server-only, **not** exported from `src/mod.ts`; wired to the engine via
  `createTransaction` (see `docs/durable-transactions.md`).
- Any external `rdfjs.Store` — e.g. `@worlds/client`'s
  `LibsqlRdfjsStore`/`DenokvRdfjsStore`.

`src/quad-store.ts` is the adapter layer between the evaluator and the store:

| Function                     | Role                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `matchQuads(store, s,p,o,g)` | Resolves the store's `match()` **stream** into an array (L89)                                         |
| `buildQuadIndex(quads)`      | O(1) positional buckets `bySubject/byPredicate/byObject` keyed by `termKey` (L21)                     |
| `probeQuadIndex(index, ...)` | Picks the smallest constrained bucket, filters the rest positionally (L56)                            |
| `GraphScopedStore`           | Read-only view fixing the graph term of every scan — GRAPH scoping with no call-site awareness (L134) |
| `namedGraphs(store)`         | Enumerates `GRAPH ?g` candidates (L157)                                                               |
| `buildDatasetStore(...)`     | Materializes the active dataset for `FROM`/`FROM NAMED` into a fresh `MemoryStore` (L180)             |

### Scan → hash join

`scanEntry()` (`src/evaluator/join.ts` L157) resolves a triple pattern
(subject/predicate/object), runs **one** `matchQuads` scan for its constant
positions, and returns a `ScanEntry` carrying the pre-fetched `candidates`.

`joinTriplePattern()` (L213) is a hash join over those candidates:

1. If any incoming binding already binds a pattern variable, the candidates are
   indexed once with `buildQuadIndex`.
2. Each binding resolves its variable positions against the index
   (`probeQuadIndex`) instead of issuing a stream round trip per binding.
3. New bindings extend the input binding; a variable already bound to a
   different term invalidates the match (checked with `sameRdfTerm`).

Result bindings are `TermBinding` (`Record<string, rdfjs.Term>`), so terms stay
in RDF/JS space for the whole evaluation and are converted to the `SparqlValue`
wire format exactly once, at the response boundary (`rdfTermToSparqlValue`,
`src/term/convert.ts` L44).

### Property paths

`scanPathEntry()` (L510) pre-computes the (subject, object) **pair set** a path
connects: from a constant endpoint, or from every graph node when both ends are
variables. Pairs are deduplicated unless the path is multiset (`isMultisetPath`,
L489 — terms, `^`, `/`, `|`). `pathSteps()` (L~600) evaluates one path step from
an anchor with recursive traversal: inverse `^`, sequence `/`, alternative `|`,
zero-or-one `?`, reflexive-transitive `*` and `+` (BFS with a visited set), and
negated property sets `!`. `joinPathPattern()` (L562) joins the pair set against
the incoming bindings.

### Graph scoping & datasets

- `GRAPH <g> { ... }` runs the inner patterns against
  `new GraphScopedStore(store, graphTerm)` — the whole inner pipeline (joins,
  paths, OPTIONAL, MINUS, nested GRAPH) stays graph-scoped without any of them
  knowing. `GRAPH ?g` additionally enumerates `namedGraphs(store)`.
- `FROM <g>` / `FROM NAMED <g>` materialize the active dataset
  (`buildDatasetStore`) and evaluate the WHERE against it (see
  `SparqlEvaluator.bgpEvaluatorFor`, `src/evaluator/sparql-evaluator.ts`). FROM
  graphs merge into the default graph (deduplicated); FROM NAMED graphs become
  the dataset's named graphs (SPARQL 1.1 §13.1).

## Stage 5 — Result assembly

- **SELECT** — `evaluateSelect()` projects `TermBinding`s with
  `rdfTermToSparqlValue` and builds the `head.vars` list (`*` widens to the
  union of bound variables).
- **ASK** — `bindings.length > 0` (SPARQL 1.1 §16.3).
- **CONSTRUCT** — `evaluateConstruct()` instantiates the template per solution:
  variables resolve from the binding, template blank nodes mint fresh labels per
  solution (`c<N>`, §16.2.1), reified templates expand via
  `expandReifiedTriples` (`src/evaluator/reified.ts`), and the result is an RDF
  graph — duplicates collapse by `termKey`.
- **DESCRIBE** — `evaluateDescribe()` collects IRIs/bnodes from the DESCRIBE
  list and each solution's bindings, then emits each resource's outgoing arcs
  (the Comunica-parity description shape).

## Memory & asynchrony model

- **Materialized, not lazy.** Every stage works on plain arrays:
  `ScanEntry.candidates` is a fully drained `matchQuads` result; `TermBinding[]`
  arrays are threaded through pattern evaluation; `aggregateValue` groups hold
  raw solutions. The engine favors pre-fetched + indexed scans over per-binding
  stream round trips.
- **Streams only at the store boundary.** `rdfjs.Stream` is consumed exactly
  once, in `matchQuads` (`src/quad-store.ts` L89), using the standard
  `data`/`end`/`error` event protocol. `MemoryStream` implements that protocol
  with zero dependencies (flow mode on `data`, pull mode on `read`/`readable`,
  completion-only on bare `end`), keeping the package browser-friendly.
- **EXISTS snapshot.** Queries containing `EXISTS`/`NOT EXISTS` resolve a
  synchronous snapshot (`quads` + `QuadIndex` + store `version`) once per
  evaluation via `BgpEvaluator.prepareExistsIndex()` L150 in
  `src/evaluator/bgp-evaluator.ts` — the **synchronous** `evaluateExists` hook
  probes it. The resolved snapshot is captured for the call and threaded
  explicitly through every EXISTS hook, so a concurrent `execute()` whose cache
  rebuilds can never swap it mid-evaluation (issue #72). The store's mutation
  version still invalidates the cache, so updates between queries never see
  stale data, and repeat evaluations of an unchanged store skip the drain
  entirely.
- **Identity & hashing.** `termKey` (`src/term/identity.ts` L8) is a sound
  RDF-term equality key used for all hashing (quad indexes, dataset dedup,
  DISTINCT, grouping); `sameRdfTerm` does structural comparison, including RDF
  1.2 triple terms (graph is not part of triple-term identity).
- **Exact numerics.** xsd:integer arithmetic and SUM stay exact via BigInt;
  decimal SUM uses BigInt significand/scale alignment (`exactDecimalSum`,
  `src/evaluator/aggregate.ts`); the canonical XPath double lexical form comes
  from `canonicalDouble` (`src/term/numeric.ts`).

## Update path

SPARQL updates bypass the query evaluator:

```
SparqlRequest.update
  → UpdateEvaluator.executeUpdate()   src/evaluator/update-evaluator.ts L90
      → one transaction per request (createTransaction) OR direct add/remove
      → applyOperation per UpdateOperation:
          insert / delete (DATA templates)
          insertdelete   (INSERT WHERE, DELETE WHERE, DELETE/INSERT)
          clear / drop / create / add / copy / move / load
      → commit() atomically, rollback() on error
```

Key mechanics: WHERE forms evaluate with the same `BgpEvaluator`;
`deleteMatches()` scans each delete template once and probes an in-memory
`QuadIndex` per solution (deduplicated removes); INSERT template blank nodes are
fresh per execution (`u<N>`), LOAD remaps document blank nodes per LOAD;
`COPY`/`MOVE` snapshot the source before clearing the destination; `LOAD` parses
the document with the in-repo Turtle/TriG/N-Triples/N-Quads parser
(`src/parser/turtle-parser.ts`) and content-sniffs the format.

## Module interaction map

```
src/mod.ts  ── public exports ────────────────►  consumers (JSR @wazoo/sparql-engine)
   │
   ├── sparql-engine-interface.ts   SparqlEngineInterface / SparqlRequest / SparqlResponse
   │
   ├── wazoo-sparql-engine.ts       WazooSparqlEngine (orchestrator)
   │       │  │
   │       │  └── evaluator/sparql-evaluator.ts    query evaluation
   │       │          ├── evaluator/bgp-evaluator.ts   pattern algebra + EXISTS
   │       │          │     ├── evaluator/join.ts      hash joins, paths, sync paths
   │       │          │     ├── evaluator/expression-evaluator.ts  expressions/FILTER
   │       │          │     ├── evaluator/reified.ts   RDF 1.2 reifier expansion
   │       │          │     └── quad-store.ts          store adapters, indexes
   │       │          ├── evaluator/select-pipeline.ts SELECT post-processing
   │       │          ├── evaluator/aggregate.ts       GROUP BY + aggregates
   │       │          └── evaluator/expression-utils.ts EXISTS/aggregate detection
   │       │
   │       └── evaluator/update-evaluator.ts   update evaluation
   │               ├── quad-store.ts
   │               ├── parser/turtle-parser.ts (LOAD)
   │               └── store/... (QuadWriteStore: addQuad/removeQuad)
   │
   ├── parser/sparql-parser.ts → parser/mod.ts → parser/parser.ts (generated)
   │       └── term/data-factory.ts (zero-dep term construction)
   │
   ├── store/memory-store.ts  store/sqlite-store.ts   rdfjs.Store implementations
   │
   └── term/  identity · convert · canonical · numeric · ordering · datetime ·
               hash · data-factory   (term algebra shared by every layer)
```

The `term/` module is the shared substrate: identity (`termKey`, `sameRdfTerm`),
conversion between AST terms, RDF/JS terms, and the wire format, canonical forms
for differential parity, numeric promotion, and the SPARQL §12.4 term ordering
used by ORDER BY, MIN/MAX, and DISTINCT.

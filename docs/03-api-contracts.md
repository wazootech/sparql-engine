---
title: API Contracts & Interface Specs
layout: default
---

# API Contracts & Interface Specs

The public surface is small and stable: one engine class implementing one
interface, typed request/response envelopes, two store implementations, and a
term-utility layer. The complete export list (verified against `deno doc --json`
of `src/mod.ts`) is at the end of this page.

## The engine interface

```typescript
// src/sparql-engine-interface.ts
export interface SparqlEngineInterface {
  execute(request: SparqlRequest): Promise<SparqlResponse>;
}

export interface SparqlRequest {
  query: string; // raw SPARQL query or update string
  baseIri?: string; // accepted; wazoo engine derives base from BASE directive
  timeoutMs?: number; // accepted; not yet enforced by the wazoo engine
}
```

`execute()` is **the** entry point. It parses the request, dispatches queries to
`SparqlEvaluator.evaluateQuery()` and updates to
`UpdateEvaluator.executeUpdate()`, and returns a discriminated union:

```typescript
export type SparqlResponse =
  | { kind: "select"; data: SparqlSelectResults }
  | { kind: "ask"; data: SparqlAskResults }
  | { kind: "construct"; data: SparqlConstructResults }
  | { kind: "void" }; // SPARQL updates always resolve to void
```

### Result shapes

```typescript
// SELECT
interface SparqlSelectResults {
  head: { vars: string[]; link?: string[] | null };
  results: { bindings: SparqlBinding[] };
}
type SparqlBinding = Record<string, SparqlValue>; // variable name → value

// ASK
interface SparqlAskResults {
  head: { link?: string[] | null };
  boolean: boolean;
}

// CONSTRUCT / DESCRIBE
interface SparqlConstructResults {
  quads: rdfjs.Quad[]; // RDF/JS quads, graph deduped
}
```

[`SparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlValue) is the
wire value format ([SPARQL 1.1](https://www.w3.org/TR/sparql11-query/) results
JSON shape, plus RDF 1.2 extensions):

```typescript
type SparqlValue =
  | { type: "uri"; value: string }
  | { type: "bnode"; value: string }
  | {
    type: "literal";
    value: string;
    "xml:lang"?: string;
    "its:dir"?: "ltr" | "rtl";
    datatype?: string;
  }
  | {
    type: "triple";
    value: {
      subject: SparqlValue;
      predicate: SparqlValue;
      object: SparqlValue;
    };
  };
```

[`rdfTermToSparqlValue()`](https://jsr.io/@wazoo/sparql-engine/doc/~/rdfTermToSparqlValue)
(`src/term/convert.ts` L44) is the only place RDF/JS terms become
[`SparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlValue)s. Plain
string literals carry no datatype (xsd:string is implicit); lang-tagged literals
carry `xml:lang` (+ `its:dir` for RDF 1.2 directional literals); RDF 1.2 triple
terms serialize as `type: "triple"`.

## Constructing the engine

```typescript
// src/wazoo-sparql-engine.ts
export interface WazooSparqlEngineOptions {
  store: rdfjs.Store; // required: any RDF/JS store
  createTransaction?: () => WazooSparqlTransaction; // optional: atomic updates
  reorderPatterns?: boolean; // default true: dynamic join ordering
  functions?: IriFunctionMap; // optional: custom IRI function registry
}
```

`store` is the only required option. `reorderPatterns: false` preserves the
written order of BGP triple patterns. `createTransaction` upgrades updates from
direct `addQuad`/`removeQuad` calls to one atomic transaction per request.
`functions` registers custom IRI functions (SPARQL 1.1 §17.4.3.1); see
[Custom functions & operators](#4-custom-functions--operators).

## Supported SPARQL surface

### Query forms

| Form                                                            | Notes                                                              | Entry point                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `SELECT` (incl. `DISTINCT`, `REDUCED`, `*`, `AS ?v` projection) | `REDUCED ≡ DISTINCT` by decision                                   | `SparqlEvaluator.evaluateSelect` |
| `ASK`                                                           | `bindings.length > 0`                                              | `evaluateAsk`                    |
| `CONSTRUCT`                                                     | template × solutions, fresh bnodes per solution, graph dedup       | `evaluateConstruct`              |
| `DESCRIBE` (`<iri>`, `?var`, `*`)                               | outgoing-arc description ([Comunica](https://comunica.dev/) shape) | `evaluateDescribe`               |

### Graph patterns (WHERE)

`bgp` (incl. reified `<< s p o >>` and annotations), `FILTER`, `BIND`, `VALUES`,
`OPTIONAL`, `MINUS`, `UNION`, `GRAPH <g>` / `GRAPH ?g`, nested `{ }` groups,
subqueries, `SERVICE` (evaluated locally; `SILENT` swallows errors). Property
paths: `^ / | ? * + !` (negated property sets).

### Expressions (FILTER / BIND / ORDER BY / HAVING / projection)

- **Comparisons** `= != < > <= >=`; **logical** `&& || !`; **arithmetic**
  `+ - * /` with XPath numeric promotion (integer stays exact via BigInt).
- **Term tests**: `bound`, `isIRI`/`isURI`, `isBLANK`, `isLITERAL`, `isNUMERIC`,
  `isTRIPLE`, `sameTerm`.
- **Strings**: `STR`, `STRLEN`, `UCASE`, `LCASE`, `CONCAT`, `SUBSTR`, `STRDT`,
  `STRLANG`, `REPLACE`, `REGEX`, `CONTAINS`, `STRSTARTS`, `STRENDS`,
  `STRBEFORE`, `STRAFTER`, `ENCODE_FOR_URI`, `LANG`, `LANGMATCHES`.
- **Misc**: `COALESCE`, `IF`, `IN`/`NOT IN`, `IRI`/`URI`, `TZ`, `BNODE`,
  `STRUUID`, `UUID`, `RAND`, `NOW`, `ABS`/`CEIL`/`FLOOR`/`ROUND`,
  `YEAR`/`MONTH`/`DAY`/`HOURS`/`MINUTES`/`SECONDS`/`TIMEZONE`,
  `MD5`/`SHA1`/`SHA256`/`SHA384`/`SHA512`, `DATATYPE`.
- **XSD constructors**: `xsd:integer`, `xsd:decimal`, `xsd:double`, `xsd:float`,
  `xsd:string`, `xsd:boolean`, `xsd:dateTime`.
- **RDF-star / RDF 1.2**: `TRIPLE`, `SUBJECT`, `PREDICATE`, `OBJECT`,
  triple-term expressions `<<( ?s ?p ?o )>>`, and `EXISTS` / `NOT EXISTS`
  (correlated, graph-scoped).
- **[SPARQL 1.2](https://www.w3.org/TR/sparql12-query/) direction functions**:
  `LANGDIR`, `STRLANGDIR`, `hasLang`, `hasLangDir`. `hasLang` is variadic — all
  three arities parse and evaluate: `hasLang(langString)`,
  `hasLang(langString, language)`, and
  `hasLang(simpleLiteral, language, direction)`. The binary/ternary forms are a
  **documented superset extension** (the published SPARQL 1.2 grammar defines
  only the unary form); arity-2 matches the language tag case-insensitively and
  arity-3 additionally matches the base direction (canonicalized to lowercase,
  consistent with `STRLANGDIR`).

Unsupported expression kinds (e.g. unknown `functionCall` IRIs) raise a clear
error rather than silently mis-evaluating.

### Aggregates (GROUP BY / HAVING)

`COUNT` (incl. `COUNT(*)`), `SUM`, `AVG`, `MIN`, `MAX`, `SAMPLE`, `GROUP_CONCAT`
(with `SEPARATOR`), each with `DISTINCT`. Semantics are pinned differentially
against Comunica: empty SUM/AVG/COUNT are `0`; SUM/AVG are unbound when any
bound argument is non-numeric; MIN/MAX use term ordering; decimal SUM is exact
(BigInt). See `src/evaluator/aggregate.ts`.

### Updates

`INSERT DATA`, `DELETE DATA`, `INSERT WHERE`, `DELETE WHERE`, `DELETE/INSERT`
(with `WITH`/`USING`/`GRAPH`), `LOAD` (incl. `INTO GRAPH`, http(s) + local file
sources), `CLEAR`/`DROP` (`DEFAULT`/`NAMED`/`ALL`/`GRAPH`), `CREATE`, `ADD`,
`COPY`, `MOVE` — all with `SILENT` where the grammar allows.

## Extensibility interfaces

### 1. Custom quad stores (the data boundary)

Any `rdfjs.Store` with `match()` is a valid read source. To support **updates**
without a transaction, the store must additionally expose `addQuad` /
`removeQuad` — the
[`QuadWriteStore`](https://github.com/wazootech/sparql-engine/blob/main/src/evaluator/update-evaluator.ts)
shape:

```typescript
// src/evaluator/update-evaluator.ts L34
export type QuadWriteStore = rdfjs.Store & {
  addQuad(item: rdfjs.Quad): unknown;
  removeQuad(item: rdfjs.Quad): unknown;
};
```

[`MemoryStore`](https://jsr.io/@wazoo/sparql-engine/doc/~/MemoryStore),
[`SqliteStore`](https://github.com/wazootech/sparql-engine/blob/main/src/store/sqlite-store.ts),
and `@worlds/client`'s `LibsqlRdfjsStore` / `DenokvRdfjsStore` all satisfy it.
If neither `createTransaction` nor `addQuad`/`removeQuad` is available, updates
throw a clear error.

### 2. Durable transactions

Provide `createTransaction` to make updates atomic and durable:

```typescript
// src/wazoo-sparql-engine.ts L16
export interface WazooSparqlTransaction {
  add(quad: rdfjs.Quad): unknown; // buffer an insert
  delete(quad: rdfjs.Quad): unknown; // buffer a delete
  commit(): Promise<void>; // persist the patch atomically
  rollback(): void; // discard the patch
}
```

One transaction is created per update request; every operation's writes are
routed through it; `commit()` runs once; any error triggers `rollback()` and
rethrows. The reference implementation is `SqliteStore.createTransaction()`
(`src/store/sqlite-store.ts`, `BEGIN IMMEDIATE` … `COMMIT`, WAL journaling) —
see `docs/durable-transactions.md`. The same shape is compatible with
`@worlds/client`'s `Transaction`, so existing durable backends pass their
transaction objects through unchanged.

### 3. Pattern-evaluation hook (EXISTS)

The expression layer is deliberately pure. `EXISTS`/`NOT EXISTS` evaluate
through an injected context:

```typescript
// src/evaluator/expression-evaluator.ts L115
export interface ExpressionEvaluationContext {
  evaluateExists?: (pattern: Pattern, solution: TermBinding) => boolean;
  evaluateNotExists?: (pattern: Pattern, solution: TermBinding) => boolean;
  baseIri?: string;
  bnodeMap?: Map<string, rdfjs.BlankNode>;
}
```

[`BgpEvaluator`](https://github.com/wazootech/sparql-engine/blob/main/src/evaluator/bgp-evaluator.ts)
binds these hooks at every expression call site (FILTER, BIND, ORDER BY, HAVING,
projection) with the current graph scope, so EXISTS works uniformly in every
expression position — nested `&&`, inside OPTIONAL, EXISTS-inside-EXISTS, and
subqueries inside EXISTS.

The hooks evaluate against a **per-call snapshot**: `prepareExistsIndex()`
returns `Promise<ExistsSnapshot>` (an internal `quads` +
[`QuadIndex`](https://github.com/wazootech/sparql-engine/blob/main/src/quad-store.ts) +
`version` record; previously `Promise<void>`), and the private context builders
— `scopedExistsContext(store, snapshot)`, `pipelineExistsContext(snapshot)` —
capture it once so a concurrent `execute()`'s cache rebuild is never observable
mid-evaluation (issue
[#72](https://github.com/wazootech/sparql-engine/issues/72)).

### 4. Custom functions & operatorsCustom IRI functions are registered through `WazooSparqlEngineOptions.functions`:

a map from function IRI to evaluator, injected like Comunica's function factory.
An `IriFunction` receives the function's evaluated arguments (`undefined` for
unbound variables and runtime type errors) and returns a result term, or
`undefined` to signal a type error — the same contract as the builtin surface:
FILTER drops the row, ORDER BY sorts it lowest. Registered functions win over
the builtin XSD-constructor mapping; unregistered IRIs keep raising
`Unsupported SPARQL expression: functionCall <iri>`.

```typescript
export type IriFunction = (
  args: ReadonlyArray<rdfjs.Term | undefined>,
) => rdfjs.Term | undefined;

export type IriFunctionMap = Readonly<Record<string, IriFunction>>;

const engine = new WazooSparqlEngine({
  store,
  functions: {
    "http://example.org/startsWithA": (args) => {
      const name = args[0];
      if (name === undefined || name.termType !== "Literal") return undefined;
      return literal(
        String(name.value.startsWith("a")),
        namedNode("http://www.w3.org/2001/XMLSchema#boolean"),
      );
    },
  },
});
```

The rest of the expression surface (operators, XSD constructors, aggregates,
update operation types) lives in `ExpressionEvaluator.evaluateOperation()` /
`evaluateFunctionCall()` (`src/evaluator/expression-evaluator.ts`) and
[`aggregateValue`](https://github.com/wazootech/sparql-engine/blob/main/src/evaluator/aggregate.ts)
/ `applyOperation` (`src/evaluator/update-evaluator.ts`).

## Term utilities (exported from `src/mod.ts`)

The engine also exports its term algebra for consumers that need RDF/JS term
handling or differential testing:

| Export                                                                                                                                                                                                                                                                                                                                   | File                                 | Purpose                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`DataFactory`](https://jsr.io/@wazoo/sparql-engine/doc/~/DataFactory), [`dataFactory`](https://jsr.io/@wazoo/sparql-engine/doc/~/dataFactory)                                                                                                                                                                                           | `src/term/data-factory.ts` L200/L238 | zero-dependency RDF/JS factory (namedNode, blankNode, literal, variable, defaultGraph, quad, fromTerm, fromQuad) |
| [`termKey`](https://jsr.io/@wazoo/sparql-engine/doc/~/termKey)                                                                                                                                                                                                                                                                           | `src/term/identity.ts` L8            | sound RDF-term hash key                                                                                          |
| [`sameRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/sameRdfTerm)                                                                                                                                                                                                                                                                   | `src/term/identity.ts` L41           | structural term equality (incl. triple terms)                                                                    |
| [`sparqlTermToRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/sparqlTermToRdfTerm) / [`rdfTermToSparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/rdfTermToSparqlValue)                                                                                                                                                        | `src/term/convert.ts` L11/L44        | AST ⇄ RDF/JS ⇄ wire conversion                                                                                   |
| [`canonicalizeRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/canonicalizeRdfTerm) / [`canonicalizeSparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/canonicalizeSparqlValue) / [`CanonicalTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/CanonicalTerm)                                                                     | `src/term/canonical.ts`              | serialization-stable projection for cross-engine parity                                                          |
| [`numericValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/numericValue), [`compareNumericValues`](https://jsr.io/@wazoo/sparql-engine/doc/~/compareNumericValues), [`formatNumber`](https://jsr.io/@wazoo/sparql-engine/doc/~/formatNumber), [`NUMERIC_DATATYPES`](https://jsr.io/@wazoo/sparql-engine/doc/~/NUMERIC_DATATYPES), `XSD*` | `src/term/numeric.ts`                | numeric value semantics                                                                                          |
| [`compareRdfTerms`](https://jsr.io/@wazoo/sparql-engine/doc/~/compareRdfTerms)                                                                                                                                                                                                                                                           | `src/term/ordering.ts` L66           | SPARQL §12.4 term ordering (ORDER BY, MIN/MAX)                                                                   |

## Public export inventory (from `deno doc --json`)

Types:
[`SparqlEngineInterface`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlEngineInterface),
[`SparqlRequest`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlRequest),
[`SparqlResponse`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlResponse),
[`SparqlSelectResults`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlSelectResults),
[`SparqlAskResults`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlAskResults),
[`SparqlConstructResults`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlConstructResults),
[`SparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlValue),
[`SparqlBinding`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlBinding),
[`WazooSparqlEngineOptions`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlEngineOptions),
[`WazooSparqlTransaction`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlTransaction),
`IriFunction`, `IriFunctionMap` (link on JSR once published),
[`CanonicalTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/CanonicalTerm).

Values/classes:
[`WazooSparqlEngine`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlEngine),
[`MemoryStore`](https://jsr.io/@wazoo/sparql-engine/doc/~/MemoryStore),
[`MemoryStream`](https://jsr.io/@wazoo/sparql-engine/doc/~/MemoryStream),
[`DataFactory`](https://jsr.io/@wazoo/sparql-engine/doc/~/DataFactory),
[`dataFactory`](https://jsr.io/@wazoo/sparql-engine/doc/~/dataFactory),
[`canonicalizeRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/canonicalizeRdfTerm),
[`canonicalizeSparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/canonicalizeSparqlValue),
[`compareNumericValues`](https://jsr.io/@wazoo/sparql-engine/doc/~/compareNumericValues),
[`compareRdfTerms`](https://jsr.io/@wazoo/sparql-engine/doc/~/compareRdfTerms),
[`formatNumber`](https://jsr.io/@wazoo/sparql-engine/doc/~/formatNumber),
[`NUMERIC_DATATYPES`](https://jsr.io/@wazoo/sparql-engine/doc/~/NUMERIC_DATATYPES),
[`numericValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/numericValue),
[`rdfTermToSparqlValue`](https://jsr.io/@wazoo/sparql-engine/doc/~/rdfTermToSparqlValue),
[`sameRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/sameRdfTerm),
[`sparqlTermToRdfTerm`](https://jsr.io/@wazoo/sparql-engine/doc/~/sparqlTermToRdfTerm),
[`serializeJsonResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/json-results.ts),
[`serializeXmlResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/xml-results.ts)
(the writers are also re-exported from the `./serialize` subpath entrypoint),
[`termKey`](https://jsr.io/@wazoo/sparql-engine/doc/~/termKey),
[`XSD`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD),
[`XSD_BOOLEAN`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_BOOLEAN),
[`XSD_DECIMAL`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_DECIMAL),
[`XSD_DOUBLE`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_DOUBLE),
[`XSD_FLOAT`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_FLOAT),
[`XSD_INTEGER`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_INTEGER),
[`XSD_STRING`](https://jsr.io/@wazoo/sparql-engine/doc/~/XSD_STRING).

Not exported (deep-import only):
[`SparqlParser`](https://github.com/wazootech/sparql-engine/blob/main/src/parser/sparql-parser.ts),
the AST types (`src/parser/ast.ts`),
[`SqliteStore`](https://github.com/wazootech/sparql-engine/blob/main/src/store/sqlite-store.ts)
(`src/store/sqlite-store.ts`), and the evaluator internals — all reachable from
source but outside the public surface, keeping the published package's runtime
dependency graph empty.

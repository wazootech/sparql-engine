<p align="center">
  <a href="https://docs.wazoo.dev">
    <img src="https://wazoo.dev/assets/wazoo.svg" alt="Wazoo Worlds" width="120" />
  </a>
  <br /><br />
  <em>Zero-dependency SPARQL 1.1 &amp; 1.2 query and update engine over RDF/JS quad stores.</em>
  <br /><br />
  <a href="https://jsr.io/@wazoo/sparql-engine"><img src="https://jsr.io/badges/@wazoo/sparql-engine" alt="JSR" /></a>
  <a href="https://jsr.io/@wazoo/sparql-engine/score"><img src="https://jsr.io/badges/@wazoo/sparql-engine/score" alt="JSR Score" /></a>
  <a href="https://github.com/wazootech/sparql-engine"><img src="https://img.shields.io/badge/GitHub-black?logo=github" alt="GitHub" /></a>
  <a href="https://deepwiki.com/wazootech/sparql-engine"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
</p>

Wazoo [SPARQL 1.1](https://www.w3.org/TR/sparql11-query/) & 1.2 Query & Update
Engine over RDF/JS Quad Stores.

## Try it in your browser

[**Open the Wazoo SPARQL Playground**](https://wazootech.github.io/sparql-engine/playground/)
— run `SELECT` / `ASK` / `CONSTRUCT` / `UPDATE` queries over sample datasets
entirely in the browser, no install, nothing sent to a server. Every query you
run gets a shareable URL.

## Compatibility

- **SPARQL 1.1 — full.** `SELECT` / `ASK` / `CONSTRUCT` / `DESCRIBE`, UPDATE,
  property paths, aggregation, subqueries, `VALUES`, and filters over any RDF/JS
  quad store. Gated by the [W3C](https://www.w3.org/) SPARQL 1.1 evaluation
  suite (differential vs [Comunica](https://comunica.dev/)): **345/345**.
- **[SPARQL 1.2](https://www.w3.org/TR/sparql12-query/) — working-draft surface
  implemented.** Direction functions (`LANGDIR`, `STRLANGDIR`, `hasLang`,
  `hasLangDir`; `hasLang` is variadic, 1–3 args, as a documented superset
  extension), RDF 1.2 reified triple terms (`<< s p o >>`) in patterns, paths,
  and updates, and the 1.2 lexical/grammar surface (a single
  Turtle/TriG/N-Triples/N-Quads superset grammar backing `LOAD`). Gated by the
  W3C SPARQL 1.2 evaluation suite (**249/249**), the RDF 1.2 eval-triple-terms
  gap suite (**41/41**), and the RDF 1.1/1.2 grammar gates.
- **CI-enforced.** Every gate above runs in the `w3c-parity` CI job — a
  spec-required behavior that regresses fails the build rather than silently
  drifting.

See [docs/05 — Verification & Testing](docs/05-testing.md) for the suite
inventory and [docs/06 — Supplemental Context](docs/06-supplemental-context.md)
for the W3C suite notes.

## Key capabilities

- **SPARQL 1.1 & 1.2 Query Engine**: Wazoo evaluation of `SELECT`, `ASK`,
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
- **JSR & Bun Wazoo**: Published on JSR as `@wazoo/sparql-engine` for Deno,
  Bun, Node.js, and browser environments. The repository's toolchain is Bun
  (`bun install && bun run test`; wazootech/workspace#50), and the source uses
  only `node:` APIs, so the same code runs on Node and Deno.
- **The engine behind `@worlds/sdk`**: Implements
  [`SparqlEngineInterface`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlEngineInterface),
  which `@worlds/sdk`'s durable backend factory (`createLibsqlSdk` from
  `@worlds/libsql`) wires into every `Sdk` — no adapter needed. (The SDK's
  former `@worlds/sdk/comunica` adapter was removed; Comunica survives only as a
  differential parity oracle in this repo.)

## Usage

```typescript
import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { MemoryStore, WazooSparqlEngine } from "@wazoo/sparql-engine";

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

### Command line

`bun run compile` builds a standalone `sparql` binary at `dist/sparql` (no
Bun install needed to run it):

```sh
bun run compile
./dist/sparql --data people.ttl --query 'SELECT * WHERE { ?s ?p ?o } LIMIT 10'
```

SELECT and ASK print SPARQL 1.1 Query Results JSON, and CONSTRUCT and DESCRIBE
print N-Quads. `bun run bench:cli` measures the binary's size, cold start,
isolated load stages, and query evaluation; see `bench/cli-bench.ts`.

### Native binary (optional)

`bun run compile` still embeds the Bun runtime (about 111 MiB on Windows). `bun run native:build` goes further and
compiles `cli/node-main.ts` with [scriptc](https://scriptc.dev) 0.4.5 into a
single executable at `dist/sparql-node` (`dist\sparql-node.exe` on Windows) with
no runtime underneath it: no Bun, no JavaScript engine, no `node_modules`.

```sh
bun run native:build
./dist/sparql-node --data people.ttl --query 'SELECT * WHERE { ?s ?p ?o } LIMIT 10'
```

`bun run native:gate` runs the whole check: `scriptc coverage` (what the
compiler can and cannot lower), the build, then the cross-host contract in
`cli/run-cli.test.ts`, which replays 12 invocations through the in-process
engine and through every built host and requires identical exit code, stdout,
and stderr. Each target test skips when its artifact is absent, so
`bun run ci` stays green on a checkout with no compiler installed.

The trade is startup and artifact size against throughput: the native binary
starts faster and is far smaller, but it reads, indexes and evaluates more
slowly per triple:

```sh
bun run bench:cli --people 200,800,3200 --runs 9 \
  --target bun-compile=dist/sparql.exe \
  --target scriptc=dist/sparql-node.exe
```

`bench:cli` runs every target once per round in a rotated order and separates
the stages by subtracting inside the round, so machine drift cannot land on one
target. At 16,000 triples, over 9 rounds (median, interquartile range), measured
with Bun 1.4.5 on Windows 11 (Intel Core Ultra 7 256V):

| Isolated operation     | `bun build --compile` | `scriptc`          | Ratio         |
| ---------------------- | --------------------- | ------------------ | ------------- |
| cold start, no data    | 63.2 ms (63-64)       | 23.2 ms (22-24)    | 2.7x faster   |
| read + parse + index   | 76.7 ms (77-81)       | 235.0 ms (230-241) | 3.1x slower   |
| friend-of-friend query | 40.2 ms (38-43)       | 60.4 ms (51-71)    | 1.4x slower   |
| binary on disk         | 110.9 MiB             | 6.2 MiB            | 17.8x smaller |

The evaluation row is a difference of two process times, so it is the noisiest;
the size-scaling fit below is the more stable comparison.

Across 1,000, 4,000 and 16,000 triples the fixed and per-triple costs separate:

| Operation              | `bun build --compile`   | `scriptc`               |
| ---------------------- | ----------------------- | ----------------------- |
| read + parse + index   | 10.8 ms + 4.1 µs/triple | 9.3 ms + 14.1 µs/triple |
| friend-of-friend query | 7.4 ms + 2.0 µs/triple  | -2.1 ms + 3.9 µs/triple |

The native evaluation fit puts the fixed term below the measurement floor, which
is why it lands slightly negative; the per-triple slope is the meaningful part.

Where the native load gap comes from has not been measured stage by stage
(tracked in [#251](https://github.com/wazootech/sparql-engine/issues/251)).

An earlier revision of this section quoted load and join as 5-43% slower. That
was measured at 1,000 triples, where the fixed costs dominate, and it hid a
quadratic tokenizer: the lexer copied the remaining input once per token, which
V8's sliced strings make free and a copy-per-slice runtime does not. At 16,000
triples that cost 11.5 s natively. Matching at an offset with sticky regexes
(`src/parser/lr-runtime.ts`) brought it to 0.48 s and made the cost linear.

The native graph is fully static. `scriptc coverage` reports 6,279/6,279
statements static (100%), 0 functions signature-blocked, 0 blocker groups, and 0
likely-hot untyped reads, and `bun run native:coverage` exits non-zero if a
blocker or an SC6101 group reappears, so the gate cannot regress quietly.

48 statements stay in scriptc's report-only dynamic tier:
code that operates on values typed only at runtime, which scriptc still lowers
to native code with checked values. The compiler's labels name the shapes —
`dyn.class` for `instanceof` and casts on interface-typed values (arbitrary
RDF/JS stores, `LrParseError`/`SparqlSyntaxError`, the injectable cost
estimator), `dyn.this` for methods reached through those values,
`dyn.hasOwn`/`dyn.hasKey` for dynamic record keys in bindings and property
reads, `dyn.objCreate` for object-shaped casts and the `{}` accumulator when a
binding is copied, and one `dynObjLit` in the CLI's error reporter. They sit at
the boundaries the package's contract defines: arbitrary stores and terms,
caught `unknown` errors, `AbortSignal` reasons, and function-valued hooks such
as join callbacks, `fetch`, and `readTextFile`.

Two JavaScript-runtime-only surfaces — RDF/JS streams and optional store statistics — never
enter the native graph. `cli/tsconfig.json` maps `src/store/quad-stream.ts` and
`src/quad-store-stream.ts` to stubs, so no RDF/JS stream is constructed or
drained natively (scans answer through `MemoryStore.getQuads`), and maps
`src/store/store-statistics.ts` and `src/planner/pattern-statistics-hook.ts` to
a stub that selects the deterministic planner fallback instead of probing a
store for an optional statistics hook. Every stub throws or returns the
documented fallback rather than emulate a JavaScript runtime.

Parity with the W3C suites is measured through the Bun build; the native host
is held to the CLI contract above plus the engine's own test suite.

#### Cross-compilation

`SCRIPTC_TARGET` cross-compiles from any host, given zig on `PATH` and the
target's runtime pack. scriptc installs only its own platform's pack, so a
cross-target build needs the target's first — either as a project dependency or
anywhere on disk through `SCRIPTC_RUNTIME_PACK`:

```sh
npm install --prefix /tmp/scriptc-pack @scriptc/runtime-linux-x64-gnu@0.4.5

SCRIPTC_TARGET=x86_64-linux-gnu.2.36 \
SCRIPTC_RUNTIME_PACK=/tmp/scriptc-pack/node_modules/@scriptc/runtime-linux-x64-gnu \
  npx scriptc@0.4.5 build cli/node-main.ts -o dist/sparql-node-linux
```

That builds an 8.4 MiB ELF. Run under WSL (Ubuntu, glibc 2.39), it matched the
Windows host byte for byte on nine of ten cases — help, argument errors, SELECT,
ASK, CONSTRUCT, `--query-file`, an unknown flag, a syntax error, and `--query`
without a value — with identical exit codes. The tenth differs only in the
missing-file message: Windows reports the resolved absolute path, Linux reports
the path as given, both with the same `ENOENT` text.

`bun run native:build` always writes the name `cli/run-cli.test.ts` discovers
(`dist/sparql-node`, plus `.exe` on Windows), so a native build on a Linux or
macOS host joins the contract automatically. A cross-built artifact for a
different platform does not: it cannot run on the build host, so verify it on
the target, as above.

Valid targets include `x86_64-linux-gnu.<glibc>`, `aarch64-linux-gnu.<glibc>`,
`x86_64-windows-gnu`, the `-musl` variants (always linked statically), and
`wasm32-wasi` for a WebAssembly module. Two build flags are worth knowing on
x86-64: `--target-cpu=x86-64-v3`, or `--cpu-dispatch` to keep one binary
portable and select the v3 code paths at startup; and, on Linux, `--static`,
which skips the dynamic loader and should widen the startup gap above. Windows
build hosts refuse `--target-cpu native`, so name a level instead. The default
is already `release` (`-O2`), and `--optimization speed` measured no gain on
this workload.

## Tree-shakeable subpath imports

The package also exposes five subpath entrypoints — `./term`, `./data-model`,
`./store`, `./parser`, and `./serialize` — so a consumer that only needs one
layer never loads the whole engine graph.

### `@wazoo/sparql-engine/term` — term algebra

RDF/JS term construction, hashing, comparison, and conversion, without the
evaluator:

```typescript
import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { sameRdfTerm, termKey } from "@wazoo/sparql-engine/term";

const { literal, namedNode } = DataFactory;
const xsd = "http://www.w3.org/2001/XMLSchema#";
const a = literal("42", namedNode(xsd + "integer"));
const b = literal("42", namedNode(xsd + "integer"));

termKey(a); // stable hash key for maps/sets
sameRdfTerm(a, b); // structural equality incl. datatype → true
```

### `@wazoo/sparql-engine/data-model` — RDF/JS DataFactoryThe canonical import for the RDF/JS `DataFactory` — the zero-dependency term

factory under the name RDF/JS consumers expect. It is an alias of `./term`
re-exporting the same module:

```typescript
import { DataFactory } from "@wazoo/sparql-engine/data-model";

const { blankNode, literal, namedNode, quad } = DataFactory;
const alice = quad(
  namedNode("https://example.org/alice"),
  namedNode("https://xmlns.com/foaf/0.1/name"),
  literal("Alice"),
);
```

`/data-model` and `/term` are the same module — importing `DataFactory` from
either yields the identical object, so the two paths can never drift.

### `@wazoo/sparql-engine/store` — RDF/JS quad store

The zero-dependency in-memory store, implementing the full `rdfjs.Store`
interface — no query engine attached:

```typescript
import { DataFactory } from "@wazoo/sparql-engine/data-model";
import { MemoryStore } from "@wazoo/sparql-engine/store";

const { literal, namedNode, quad } = DataFactory;
const store = new MemoryStore([
  quad(
    namedNode("https://example.org/alice"),
    namedNode("https://xmlns.com/foaf/0.1/name"),
    literal("Alice"),
  ),
]);

// `match` returns an RDF/JS stream (async iterable)
for await (const q of store.match(namedNode("https://example.org/alice"))) {
  console.log(q.object.value); // "Alice"
}
```

### `@worlds/sqlite` — durable SQLite store

The durable `node:sqlite` store moved out of this package into
[`@worlds/sqlite`](https://github.com/wazootech/worlds-sqlite) (the RDF/JS store
is packaged with the worlds impl). The engine stays store-agnostic and consumes
it through the `createTransaction` hook:

```typescript
import { SqliteStore } from "@worlds/sqlite";
import { WazooSparqlEngine } from "@wazoo/sparql-engine";

const store = new SqliteStore({ path: "data.sqlite" });
const engine = new WazooSparqlEngine({
  store,
  createTransaction: () => store.createTransaction(),
});
```

### `@wazoo/sparql-engine/parser` — SPARQL AST + Turtle parsers

Parse SPARQL 1.1 & 1.2 into the sparqljs-compatible AST without loading the
evaluator, and parse Turtle-family documents into RDF/JS quads:

```typescript
import { parseTurtleQuads, SparqlParser } from "@wazoo/sparql-engine/parser";

const ast = new SparqlParser({ sparqlStar: true }).parse(
  "SELECT ?s WHERE { ?s ?p ?o }",
);
console.log(ast.type); // "query"
console.log(ast.variables); // [Variable{ value: "s" }]

// Turtle / TriG / N-Triples / N-Quads → RDF/JS quads (graphs preserved)
const quads = parseTurtleQuads(
  '@prefix : <https://example.org/> . :alice :name "Alice" .',
);
console.log(quads[0].object.value); // "Alice"
```

### `@wazoo/sparql-engine/serialize` — results writers + Turtle writer

Serialize a
[`SparqlResponse`](https://jsr.io/@wazoo/sparql-engine/doc/~/SparqlResponse) to
SPARQL results JSON (`.srj`) or XML (`.srx`), or RDF/JS quads to
Turtle/TriG/N-Quads/N-Triples:

```typescript
import {
  serializeJsonResults,
  serializeTurtle,
  serializeXmlResults,
} from "@wazoo/sparql-engine/serialize";

const response = {
  kind: "select",
  data: {
    head: { vars: ["s"] },
    results: {
      bindings: [{ s: { type: "uri", value: "https://example.org/alice" } }],
    },
  },
};

serializeJsonResults(response); // {"head":{"vars":["s"]},"results":…}
serializeXmlResults(response); // <?xml version="1.0" encoding="UTF-8"?>…

// The writer counterpart to parseTurtleQuads — lossless round-trip, incl.
// RDF 1.2 triple terms and named graphs (TriG blocks in Turtle mode).
serializeTurtle(quads, {
  format: "turtle",
  prefixes: { ex: "https://example.org/" },
});
serializeTurtle(quads, { format: "n-quads" });
```

The subpaths can be mixed freely — e.g. the store above with the term layer, or
the serializers fed by `engine.execute()`'s response. Anything not re-exported
through `./term`, `./data-model`, `./store`, `./parser`, or `./serialize` (or
the root entrypoint) is private surface.

## Parity testing

The differential test suite in `test/parity/` proves behavioral equivalence with
`@comunica/query-sparql-rdfjs-lite`, the engine this project ports 1:1. Every
case seeds both engines with identical RDF/JS stores, runs the same query
through each, and deep-compares the observable results: SELECT bindings
(projected variables and values, with ORDER BY emission order compared exactly),
ASK booleans, and CONSTRUCT quads.

Blank nodes are compared by identity, not by label. Comunica skolemizes blank
nodes from query sources into prefixed labels (`bc_<sourceId>_<label>`); the
wazoo engine returns the store's own labels. SPARQL 1.1 result semantics treat
blank node labels as scoped and opaque, so the wazoo engine deliberately does
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
ordering: a three-pattern chain written in worst-case order runs ~60x faster
with reordering enabled, because the planner scans each pattern once and joins
in order of estimated cost, preferring patterns whose variables are already
bound. Timings use [mitata](https://github.com/evanwashere/mitata) through the
shared harness in `bench/bench.ts` (it runs on Bun) with the wazoo
engine as the per-group baseline:

```bash
bun run bench
```

### Results

A snapshot measured with Bun 1.4.5 on Windows 11 (Intel Core Ultra 7 256V),
with the wazoo engine as the per-group baseline. Each cell is the per-iteration
average; every query is cross-verified to return identical results on all three
engines before timing (computed decimals, floats and doubles compare by value).
Timings are machine-specific and move between runs, often by 15-30% on the
sub-millisecond rows, so treat close pairs as ties. Run `bun run bench` for your
own numbers.

Core joins, 400-person graph (~2,200 quads):

| query                        | wazoo   | comunica | oxigraph |
| ---------------------------- | ------- | -------- | -------- |
| full scan                    | 0.41 ms | 3.0 ms   | 5.5 ms   |
| join (knows × name)          | 1.1 ms  | 3.3 ms   | 1.2 ms   |
| asymmetric join              | 1.1 ms  | 14.9 ms  | 5.9 ms   |
| reorder chain, written order | 82.6 ms | 2.6 ms   | 1.2 ms   |
| reorder chain, planner on    | 1.3 ms  | —        | —        |
| dp-join, DP plan             | 20.3 ms | 106.2 ms | 2.5 s    |
| dp-join, greedy plan         | 19.9 ms | —        | —        |

EXISTS surface, 400-person graph:

| query               | wazoo   | comunica | oxigraph |
| ------------------- | ------- | -------- | -------- |
| `FILTER EXISTS`     | 0.27 ms | 7.6 ms   | 0.41 ms  |
| `FILTER NOT EXISTS` | 0.32 ms | 8.8 ms   | 0.42 ms  |
| nested `EXISTS`     | 0.42 ms | 19.7 ms  | 0.55 ms  |
| nested `NOT EXISTS` | 0.45 ms | 19.7 ms  | 0.54 ms  |

EXISTS surface, 10,000-person graph (~55,000 quads):

| query               | wazoo   | comunica | oxigraph |
| ------------------- | ------- | -------- | -------- |
| `FILTER EXISTS`     | 10.5 ms | 197 ms   | 13.2 ms  |
| `FILTER NOT EXISTS` | 9.8 ms  | 194 ms   | 13.6 ms  |
| nested `EXISTS`     | 16.9 ms | 407 ms   | 15.7 ms  |
| nested `NOT EXISTS` | 16.1 ms | 393 ms   | 16.5 ms  |

Scaling the data 25x (400 → 10,000 people) grows wazoo's EXISTS cost ~36-40x,
while nesting stays within ~1.6x of the simple case at both scales: the snapshot
is drained and indexed once per query, and each probe touches only its candidate
bucket, so nesting stays cheap relative to the dataset. Across the exists
surface wazoo is ~19-48x faster than comunica, and at parity with or ahead of
oxigraph (a compiled Rust/WASM engine with native indexes).

On the core rows wazoo is fastest on the full scan and the asymmetric join, and
the plain join is within run-to-run noise of oxigraph. The reorder chain is the
exception: in written order wazoo is far behind both references, and with its
planner on it is level with oxigraph. The two dp-join plans measure the same in
this snapshot.

Join surface, 10,000-person graph (~55,000 quads) — UNION joins 10k x 20k
bindings on the shared subject (~200M candidate pairs); OPTIONAL and MINUS join
10k x 5k (~50M pairs). The wazoo engine's hash join probes an indexed right side
per left binding instead of scanning it:

| query               | wazoo   | comunica | oxigraph |
| ------------------- | ------- | -------- | -------- |
| UNION (10k x 20k)   | 21.1 ms | 58.9 ms  | 48.9 ms  |
| OPTIONAL (10k x 5k) | 9.1 ms  | 253 ms   | 27.7 ms  |
| MINUS (10k x 5k)    | 7.5 ms  | 26.3 ms  | 11.3 ms  |

On this surface wazoo leads all three engines, and the fan-out join scaling is
sub-quadratic. When the hash join landed (measured under Deno), the same UNION
went from ~7 s per iteration with a nested loop to ~38 ms.

The same snapshot as a chart — one row per query class, three bars per row
(wazoo green, Comunica orange, Oxigraph blue), bar length proportional to avg
ms/iter within the row:

<figure>
  <img src="docs/assets/chart-latency.svg" alt="Bar chart of average query latency per query class for wazoo, Comunica, and Oxigraph">
  <figcaption><b>Fig — Query latency by class.</b> One row per query class;
  three bars per row, bar length proportional to average ms/iter within the
  row (each row normalized to its slowest engine — lower is better). The
  planner-only rows (3-pattern chain, planner on) have a single wazoo bar;
  Comunica and Oxigraph have no reordering equivalent. Snapshot from
  `bench/latency-data.json`, regenerated by `bun run bench:latency`.</figcaption>
</figure>

### Size & memory footprint

The speed comparison is only half the story — engines also differ by orders of
magnitude in what they cost to ship and to run. A size bar chart and a memory
treemap (length/area ∝ size) summarize both:

**Library size on disk** — what a consumer must have installed:

<figure>
  <img src="docs/assets/chart-library-size.svg" alt="Bar chart of engine footprints on disk">
  <figcaption><b>Fig 1 — Library size on disk.</b> One bar per engine; bar
  length is proportional to total installed size (values in binary MiB, share
  of the combined total in parentheses). Wazoo (green) is the whole JSR
  artifact at 1.24 MiB against comunica’s 38.25 MiB closure (orange);
  oxigraph (blue) sits between.</figcaption>
</figure>

| engine   | on disk      | contents                                                                                                                      |
| -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| wazoo    | **1.24 MiB** | 115 files (the whole JSR artifact: `src/` + `README.md` + `LICENSE`; build-time grammars excluded); zero runtime dependencies |
| oxigraph | 8.39 MiB     | WASM runtime (8.25 MiB) + JS glue/types                                                                                       |
| comunica | 38.25 MiB    | 367 npm packages in the transitive dependency closure                                                                         |

Regenerated by `bun run bench:size`. The wazoo artifact is **~1.24 MiB on disk
(~0.23 MiB gzipped)**; the generated SPARQL parser is about 0.51 MiB of it. The
JSR `publish.exclude` drops tests and the build-time grammar sources
(`*.jison`, `generate-parser.ts`). The durable SQLite store moved to
`@worlds/sqlite` (2026-08-17), so the root import graph is server-optional. The
chart and the `bench:size` JSON both mirror that file set.

**Peak resident memory during execution** on the 10k-person graph (55k quads),
measured in an isolated subprocess per engine (peak
`process.memoryUsage().rss` over 5 runs). Every figure includes the shared
~51 MiB Bun runtime and dataset baseline. Resident memory is compared because
Bun reports a `heapUsed` for oxigraph's WASM memory that is larger than the
whole process:

<figure>
  <img src="docs/assets/treemap-memory.svg" alt="Treemap of peak resident memory per engine and workload">
  <figcaption><b>Fig 4 — Peak resident memory during execution</b> (10k-person
  graph). One panel per workload (full scan, nested EXISTS); within each, the
  three engines’ tiles are scaled by their peak RSS (values in MiB).</figcaption>
</figure>

| workload             | wazoo       | comunica | oxigraph    |
| -------------------- | ----------- | -------- | ----------- |
| full scan (55k rows) | **197 MiB** | 337 MiB  | 289 MiB     |
| nested EXISTS        | 193 MiB     | 239 MiB  | **187 MiB** |

Wazoo is the smallest on disk by 7-31x (1.24 vs 8.39 vs 38.25 MiB). It uses the
least memory on the full scan, and on nested EXISTS it is within a few percent
of oxigraph and below comunica.

These are machine-specific snapshots (Bun 1.4.5, Windows 11), not guarantees.
Regenerate them with `bun run bench:size` (library sizes, from the installed
packages) and `bun run bench:memory` (peak memory, spawned per engine), which
write the SVGs into `docs/assets/`.

## Development

```bash
bun run ci
```

## Query design notes

Most performance work is the engine's job and happens automatically: greedy join
reordering, hash joins over shared variables, the positional store index, and
the once-per-query EXISTS snapshot with indexed probes. The query shapes below
are expensive **by semantics** — the cost is proportional to the result the
query itself asks for, so no engine can make them cheap without changing the
answer. Treat them as the operator's responsibility:

- **Joins with no shared variables.** A join (BGP patterns, UNION branches,
  OPTIONAL, MINUS) over disjoint variable sets is a cross product — n·m rows by
  definition, per SPARQL §18.2.2's natural join on an empty key. The hash join
  does not change this: the result size _is_ the cost. Correlate the sides on a
  shared variable (typically the subject). The same trap applies to
  `OPTIONAL { ?x <pet> ?p }` whose group shares nothing with the outer query —
  every outer row merges with every group row; bind the group to the outer
  solution instead.
- **Property paths with both endpoints unbound.** `?a <knows>+ ?b` walks the
  path forward from every graph node, because the reachable-set has to be
  computed before any solution can be formed. Binding one endpoint
  (`<person1> <knows>+ ?b`) turns it into one anchored walk; reflexive forms
  (`?`, `*`) additionally materialize the (node, node) pair.
- **Queries whose result is the whole store.** `SELECT * WHERE { ?s ?p ?o }`
  over 55k quads materializes 55k rows; the positional index makes each pattern
  scan O(bucket) instead of O(store), but the result materialization is
  inherent. Bind a selective subject, push FILTERs down, or use LIMIT — the
  engine evaluates everything before slicing, so a small LIMIT over a huge scan
  still pays the scan (streaming is tracked as
  [#74](https://github.com/wazootech/sparql-engine/issues/74)).
- **Correlated EXISTS over broad scopes.** EXISTS snapshots drain and index once
  per query, and probes touch only the candidate bucket — but a correlated
  `FILTER EXISTS { ?s <knows> ?who }` whose correlation variable is bound
  _outside_ the EXISTS still runs once per outer solution. Bind the correlation
  variable in the outer query.
- **Non-selective data shapes.** If every node is connected to every node, the
  compatible-candidate set for a join _is_ the whole right side, and no join
  strategy beats scanning it. Prefer selective predicates on the hot path —
  indexes help only when buckets are smaller than the full set.

## Prior art & attribution

This engine's performance work (join reordering, hash joins, positional indexes,
streaming, EXISTS snapshots) and spec-driven semantics build on published
research, standards, and reference books. Citations appear inline in the source
at each technique site as stock JSDoc `@see` / `{@link}` tags; this section
collects them for reference and is kept in sync by convention: any PR that adds
a citation to the code adds the matching line here (and vice versa).

### Research papers

- Bernstein, P. A., & Chiu, D.-M. W. "Using Semi-Joins to Solve Relational
  Queries." Journal of the ACM 28(1), 1981, pp. 25–40.
  https://doi.org/10.1145/322234.322238
- Goldberg, D. "What Every Computer Scientist Should Know About Floating-Point
  Arithmetic." ACM Computing Surveys 23(1), 1991, pp. 5–48.
  https://doi.org/10.1145/103162.103163
- Graefe, G. "Query Evaluation Techniques for Large Databases." ACM Computing
  Surveys 25(2), 1993, pp. 73–170. https://doi.org/10.1145/152610.152611
- Graefe, G. "Volcano — An Extensible and Parallel Query Evaluation System."
  IEEE Transactions on Knowledge and Data Engineering 6(1), 1994, pp. 120–135.
  https://doi.org/10.1109/69.273032
- Gupta, A., & Mumick, I. S. "Maintenance of Materialized Views: Problems,
  Techniques and Applications." IEEE Data Engineering Bulletin 18(2), 1995, pp.
  3–18. https://dblp.org/rec/journals/debu/GuptaM95.html
- Hartig, O. "Foundations of RDF* and SPARQL* (An Alternative Approach to
  Statement-Level Metadata in Linked Data)." Proc. 11th Alberto Mendelzon Intl.
  Workshop on Foundations of Data Management (AMW), CEUR-WS Vol-1912, 2017.
  https://ceur-ws.org/Vol-1912/paper12.pdf
- Kitsuregawa, M., Tanaka, H., & Yamamori, T. "Architecture and Performance of
  Relational Algebra Machine GRACE." Proc. Intl. Conf. on Parallel Processing
  (ICPP), 1983, pp. 241–250.
- Kostylev, E. V., Reutter, J. L., Romero, M., & Vrgoč, D. "SPARQL with Property
  Paths." Proc. 14th Intl. Semantic Web Conf. (ISWC 2015), LNCS 9366, Springer,
  2015, pp. 3–18. https://doi.org/10.1007/978-3-319-25007-6_1
- Neumann, T., & Weikum, G. "RDF-3X: A RISC-Style Engine for RDF." Proc. VLDB
  Endowment 1(1), 2008, pp. 647–659. https://doi.org/10.14778/1453856.1453927
- Pérez, J., Arenas, M., & Gutierrez, C. "Semantics and Complexity of SPARQL."
  ACM Transactions on Database Systems 34(3), 2009, art. 16.
  https://doi.org/10.1145/1567274.1567278
- Selinger, P. G., Astrahan, M. M., Chamberlin, D. D., Lorie, R. A., & Price, T.
  G. "Access Path Selection in a Relational Database Management System." Proc.
  ACM SIGMOD, 1979, pp. 23–34. https://doi.org/10.1145/582095.582099
- Sellis, T. K. "Multiple-Query Optimization." ACM Transactions on Database
  Systems 13(1), 1988, pp. 23–52. https://doi.org/10.1145/42201.42203
- Shapiro, L. D. "Join Processing in Database Systems with Large Main Memories."
  ACM Transactions on Database Systems 11(3), 1986, pp. 239–264.
  https://doi.org/10.1145/6314.6315
- Stocker, M., Seaborne, A., Bernstein, A., Kiefer, C., & Reynolds, D. "SPARQL
  Basic Graph Pattern Optimization Using Selectivity Estimation." Proc. 17th
  Intl. World Wide Web Conf. (WWW '08), ACM, 2008, pp. 595–604.
  https://doi.org/10.1145/1367497.1367578
- Weiss, C., Karras, P., & Bernstein, A. "Hexastore: Sextuple Indexing for
  Semantic Web Data Management." Proc. VLDB Endowment 1(1), 2008, pp. 1008–1019.
  https://doi.org/10.14778/1453856.1453965

### Standards & RFCs

- Harris, S., & Seaborne, A. (eds.). "SPARQL 1.1 Query Language." W3C
  Recommendation, 21 March 2013. https://www.w3.org/TR/sparql11-query/
- Malhotra, A., Melton, J., & Walsh, N. (eds.). "XQuery 1.0 and XPath 2.0
  Functions and Operators (Second Edition)." W3C Recommendation, 14
  December 2010. https://www.w3.org/TR/2010/REC-xpath-functions-20101214/
- National Institute of Standards and Technology. "Secure Hash Standard (SHS)."
  FIPS PUB 180-4, August 2015.
  https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
- "RDF 1.2 Concepts and Abstract Data Model." W3C Candidate Recommendation, 7
  April 2026. https://www.w3.org/TR/rdf12-concepts/
- Rivest, R. "The MD5 Message-Digest Algorithm." IETF RFC 1321, April 1992.
  https://www.rfc-editor.org/rfc/rfc1321

### Reference books

- Aho, A. V., Sethi, R., & Ullman, J. D. "Compilers: Principles, Techniques, and
  Tools." Addison-Wesley, 1986, ch. 4 (syntax analysis, LR parsing).
- Cormen, T. H., Leiserson, C. E., Rivest, R. L., & Stein, C. "Introduction to
  Algorithms," 3rd ed. MIT Press, 2009, §22.2 (breadth-first search).

## Releases

Every merge to `main` runs the Publish workflow. It publishes through the `jsr`
CLI (`bunx jsr publish`) **only when `jsr.json`'s `version` is not on JSR yet**;
it asks JSR's `meta.json` rather than the tree:

- **Release PR** (bumps `version`): the Publish job publishes the new version.
- **Routine PR** (no bump): the Publish job skips with a notice — this is
  expected, not an error.

To ship a release, bump `version` in `jsr.json` (minor for additive public API,
patch for fixes) in the same PR that should publish. `jsr publish` refuses a
dirty tree, so `bun install --frozen-lockfile` must leave `bun.lock` untouched
and the Deno lockfile that `jsr` regenerates stays gitignored.

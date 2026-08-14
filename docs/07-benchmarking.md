---
title: Benchmarking & Performance
layout: default
---

# Benchmarking & Performance

The engine ships four benchmark surfaces — one latency comparison, one CI
regression gate, one concurrency stress probe, and two footprint measurers. This
page documents the methodology behind each and the known results measured on the
reference machine. Run instructions live in
[05 — Verification & Testing](05-testing.md); this page is the "why it's
trustworthy and what the numbers say" companion.

| Tool                         | Task                            | Measures                                                                              | Gate |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| `bench/engine_bench.ts`      | `deno task bench`               | Query/update latency vs Comunica + Oxigraph                                           | no   |
| `bench/budget.ts`            | `deno task bench:check`         | Latency regression vs `bench/baseline.json`                                           | CI   |
| `bench/concurrency-probe.ts` | (manual)                        | EXISTS snapshot isolation under concurrency                                           | no   |
| `bench/measure-libs.ts`      | `deno task bench:size`          | On-disk footprint of each engine                                                      | no   |
| `bench/collect-memory.ts`    | `deno task bench:memory`        | Peak heap during execution                                                            | no   |
| `bench/treemap.ts`           | (both of the above)             | Renders the two JSON snapshots into `docs/assets/treemap-*.svg`                       | no   |
| `bench/latency-chart.ts`     | `deno task bench:latency`       | Renders the `deno bench --json` latency snapshot into `docs/assets/chart-latency.svg` | no   |
| `bench/latency-check.ts`     | `deno task bench:latency:check` | Fails when the committed snapshot's bench inventory is stale vs a fresh run           | CI   |

## `deno task bench` — three-engine latency comparison

`bench/engine_bench.ts` runs the wazoo engine against
`@comunica/query-sparql-rdfjs-lite` and **Oxigraph (WASM)** over identical
generated graphs. Deno's built-in bench runner times each group, with the wazoo
engine as the per-group baseline.

### Why the timings are trustworthy

1. **Verification first.** Before any timing, every query asserts all three
   engines return identical results (`verifySelectEquality`,
   `verifyAskEquality`, `verifyConstructEquality`, `verifyConstructIsoEquality`
   — CONSTRUCT under the graph-result multiset contract: reference deduplicated,
   wazoo as-emitted (issue #87) — and every update asserts identical final store
   contents on fresh stores (`verifyUpdateEquality`). A benchmark of a broken
   engine fails loudly, not silently.
2. **Self-restoring updates.** The timed update deletes and re-inserts the same
   quads, netting to zero per iteration, so the benchmark stores never drift.
3. **Per-group baselines.** Each group is timed independently; results are
   per-iteration averages over the runner's sample window.

Groups cover the feature surface: scan, join, asym-join (reorder on/off),
reorder-chain, ask, construct, update, optional, minus, union, path,
group-aggregate, filter-expr, order-limit, distinct, values-bind, graph, from,
subquery, exists, cast, string-fn, having, reduced, update-ops.

### Known results

Snapshot measured on a Windows desktop, Deno 2.9.5, wazoo engine as the
per-group baseline. Each cell is the per-iteration average; every query was
cross-verified identical on all three engines before timing. Machine-specific —
run `deno task bench` for your own numbers.

Core joins, 400-person graph (~2,200 quads):

| query                        | wazoo   | comunica | oxigraph |
| ---------------------------- | ------- | -------- | -------- |
| full scan                    | 0.96 ms | 5.5 ms   | 12.2 ms  |
| join (knows × name)          | 0.66 ms | 3.1 ms   | 3.4 ms   |
| asymmetric join              | 1.2 ms  | 19.2 ms  | 19.3 ms  |
| reorder chain, written order | 97.4 ms | 96.8 ms  | 4.2 ms   |
| reorder chain, planner on    | 1.2 ms  | —        | —        |

EXISTS surface, 400-person graph:

| query               | wazoo  | comunica | oxigraph |
| ------------------- | ------ | -------- | -------- |
| `FILTER EXISTS`     | 1.0 ms | 19.3 ms  | 1.6 ms   |
| `FILTER NOT EXISTS` | 0.9 ms | 20.1 ms  | 1.4 ms   |
| nested `EXISTS`     | 1.2 ms | 74.8 ms  | 1.7 ms   |
| nested `NOT EXISTS` | 1.2 ms | 75.2 ms  | 1.8 ms   |

EXISTS surface, 10,000-person graph (~55,000 quads):

| query               | wazoo   | comunica | oxigraph |
| ------------------- | ------- | -------- | -------- |
| `FILTER EXISTS`     | 33.0 ms | 466.1 ms | 34.0 ms  |
| `FILTER NOT EXISTS` | 33.2 ms | 466.2 ms | 32.9 ms  |
| nested `EXISTS`     | 40.9 ms | 1.9 s    | 39.4 ms  |
| nested `NOT EXISTS` | 43.0 ms | 1.8 s    | 40.6 ms  |

Join surface, 10,000-person graph — UNION joins 10k × 20k bindings on the shared
subject (~200M candidate pairs); OPTIONAL and MINUS join 10k × 5k (~50M pairs):

| query               | wazoo   | comunica | oxigraph |
| ------------------- | ------- | -------- | -------- |
| UNION (10k × 20k)   | 37.9 ms | 87.1 ms  | 98.2 ms  |
| OPTIONAL (10k × 5k) | 15.4 ms | 444.4 ms | 46.0 ms  |
| MINUS (10k × 5k)    | 13.3 ms | 31.7 ms  | 17.1 ms  |

The same snapshot as a chart — one row per query class, three bars per row
(wazoo green, Comunica orange, Oxigraph blue), bar length proportional to avg
ms/iter within the row:

<figure>
  <img src="assets/chart-latency.svg" alt="Bar chart of average query latency per query class for wazoo, Comunica, and Oxigraph">
  <figcaption><b>Fig — Query latency by class.</b> One row per query class;
  three bars per row, bar length proportional to average ms/iter within the
  row (each row normalized to its slowest engine — lower is better). The
  planner-only rows (3-pattern chain, planner on) have a single wazoo bar;
  Comunica and Oxigraph have no reordering equivalent. Snapshot from
  `bench/latency-data.json`, regenerated by `deno task bench:latency`; the
  `latency-snapshot` CI job re-runs the suite in inventory mode
  (`bench:latency:check`) and fails if this snapshot's bench set goes stale
  (add, rename, or remove a bench without regenerating).</figcaption>
</figure>

### Reading the numbers

- **Core joins**: wazoo is fastest on every scan/join row, with the asymmetric

  join ~16× faster than Comunica.
- **Join scaling is sub-quadratic.** The wazoo hash join probes an indexed right
  side per left binding instead of scanning it: the nested-loop before-state of
  the UNION benchmark was ~7 s/iter versus ~38 ms with the hash join (~185×),
  with OPTIONAL and MINUS showing the same shape (~60-80×).
- **EXISTS is flat as data grows.** Scaling the data 25× (400 → 10,000 people)
  grows wazoo's EXISTS cost ~35× while nesting stays within ~1.2× of the simple
  case at both scales: the EXISTS snapshot is drained and indexed once per
  query, and each probe touches only its candidate bucket, so nesting stays
  cheap relative to the dataset. Across the EXISTS surface wazoo is ~15-65×
  faster than Comunica and roughly at parity with Oxigraph (a compiled Rust/WASM
  engine with native indexes, which stays ahead on the reorder-chain row).
- **The dynamic join planner is worth ~80×** on the worst-case-ordered
  three-pattern chain (97.4 ms → 1.2 ms) — see

  [02 — System Architecture & Query Pipeline](02-architecture.md), Stage 3.

## `deno task bench:check` — regression budget

`bench/budget.ts` is the CI perf gate. It runs two queries — a 2-pattern BGP
join and the reorder chain — 50× each against a 100-subject store and fails if
the average latency exceeds the budget in `bench/baseline.json`:

```json
{
  "maxAllowedMs": 50.0,
  "maxRegressionRatio": 0.15
}
```

A change fails the gate if either query averages more than `maxAllowedMs` (50
ms) or regresses more than `maxRegressionRatio` (15%) versus the recorded
baseline. Tune `bench/baseline.json` deliberately: raise `maxAllowedMs` only for
hardware-dependent thresholds, and re-baseline via the recorded average when a
measured improvement lands.

## `bench/concurrency-probe.ts` — EXISTS concurrency stress

Standalone probe for issue #72 (a concurrent `execute()` must never observe
another call's EXISTS snapshot rebuild). Five queries cover the EXISTS surface —
flat, `NOT EXISTS`, nested, `ORDER BY`, and `GROUP BY` + `OPTIONAL` — over a
300-subject store:

1. **Static-store concurrency** — 40 rounds of a shuffled query mix run via
   `Promise.all`, asserting every round matches the sequential baseline
   byte-for-byte.
2. **Update interleaving** — 20 rounds of a self-restoring DELETE/INSERT UPDATE
   running concurrently with EXISTS queries, asserting no call errors (exact
   results are undefined mid-mutation).

Any error or divergence exits 1; the same guarantees are locked in as unit tests
in `src/wazoo-sparql-engine.test.ts`.

## `deno task bench:size` / `bench:memory` — footprint

### Methodology

- `bench:size` — `bench/measure-libs.ts` measures the on-disk footprint a
  consumer must install: the wazoo JSR publish artifact (`src/` + `README.md`
  - `LICENSE`, broken down by top-level module), the installed Oxigraph npm
    package (WASM binary vs JS glue), and `@comunica/query-sparql-rdfjs-lite`
    plus its full transitive dependency closure → `bench/size-data.json`.
- `bench:memory` — `bench/collect-memory.ts` spawns `bench/memory-probe.ts` per
  engine × workload in an **isolated Deno subprocess** (so only the target
  engine is loaded), executing each workload 5× and reporting peak
  `Deno.memoryUsage()` (`heapUsed` + `rss` + `external`) on a 10,000-person
  graph (~55,000 quads) → `bench/memory-data.json`.
- `bench/treemap.ts` renders both JSON snapshots into
  `docs/assets/treemap-{library-size,memory}.svg` (area ∝ size) — the SVGs are
  committed, so the published wiki and README stay in sync with the
  measurements.

### Known results

On-disk footprint (what a consumer must have installed):

| engine   | on disk      | contents                                                                                              |
| -------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| wazoo    | **0.67 MiB** | 38 source files (the whole JSR artifact: `src/` + `README.md` + `LICENSE`); zero runtime dependencies |
| oxigraph | 7.9 MiB      | WASM runtime (7.8 MiB) + JS glue/types                                                                |
| comunica | 28.3 MiB     | 368 npm packages in the transitive dependency closure                                                 |

Wazoo breaks down as evaluator 226 KiB, parser 381 KiB, store 24 KiB, term 40
KiB, README 13 KiB, LICENSE 1 KiB — the parser is the largest single module (the
generated `parser.ts` from `sparql.jison`).

Peak heap during execution (`heapUsed`; isolated subprocess per engine, peak
over 5 runs, all three share the same ~65 MB runtime baseline so the comparison
is symmetric):

| workload             | wazoo      | comunica | oxigraph |
| -------------------- | ---------- | -------- | -------- |
| full scan (55k rows) | **134 MB** | 214 MB   | 251 MB   |
| nested EXISTS        | **82 MB**  | 271 MB   | 108 MB   |

![Library size treemap](assets/treemap-library-size.svg)

![Memory treemap](assets/treemap-memory.svg)

Wazoo is the smallest on disk by 12-42× (0.67 vs 7.9 vs 28.3 MiB) and holds its
speed advantage with the lowest peak heap on both workloads — including a peak
roughly a third of Comunica's on the nested-EXISTS surface the timings above
highlight. Oxigraph's WASM runtime is compact on disk, but its result
materialization peaks higher than wazoo on both workloads. The probe also
records peak RSS in `bench/memory-data.json` for deeper analysis.

## Regenerating and committing results

```bash
deno task bench        # latency: prints tables, verifies results first
deno task bench:check  # CI gate: pass/fail vs bench/baseline.json
deno run --allow-all bench/concurrency-probe.ts   # exit 1 on any divergence
deno task bench:size   # measure-libs → size-data.json → treemap SVGs → fmt
deno task bench:memory # collect-memory → memory-data.json → treemap SVGs → fmt
deno task bench:latency:check  # CI gate: fresh run vs committed latency snapshot (inventory)
```

All measurements are machine-specific snapshots (the reference numbers above are
Deno 2.9.5 on Windows), not guarantees. When you regenerate `bench:size`,
`bench:memory`, or `bench:latency`, commit the updated `bench/*-data.json`
**and** the `docs/assets/*.svg` together — the tasks format the SVGs, so a
committed SVG should always be byte-identical to what `deno fmt` produces.
`bench:latency:check` compares only the bench **inventory**
(group/name/baseline) against a fresh `deno bench --json` run — timing values
are machine-specific and never compared.

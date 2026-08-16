# Prototypes — scriptc feasibility research (#143)

Standalone spike artifacts from the scriptc evaluation on
[#143](https://github.com/wazootech/sparql-engine/issues/143). Each file is
self-contained (no imports from `src/`), intentionally **not** wired into the CI
tasks or the publish graph, and exists to settle one open question with measured
evidence.

| File                          | Issue                                                         | Question                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `binding-obj-vs-map-bench.ts` | [#147](https://github.com/wazootech/sparql-engine/issues/147) | Cost of refactoring `TermBinding` from `Record<string, Term>` to `Map<string, Term>` (scriptc's static tier rejects dynamic-keyed records) |
| `decimal-string-sum.ts`       | [#146](https://github.com/wazootech/sparql-engine/issues/146) | Exact xsd:integer / xsd:decimal SUM on sign+magnitude digit strings, byte-identical to the BigInt path, without BigInt                     |
| `decimal-string-sum-test.ts`  | [#146](https://github.com/wazootech/sparql-engine/issues/146) | Unit spot-checks + 40k differential fuzz vs the BigInt reference + perf comparison                                                         |

## Run

```bash
# Decimal-string layer: correctness (differential vs BigInt) + perf
deno run --allow-all prototypes/decimal-string-sum-test.ts

# Object-vs-Map binding micro-benchmark (V8)
deno bench --allow-all prototypes/binding-obj-vs-map-bench.ts
```

## Findings (as of filing)

- **#147**: `Map` regresses the hot binding ops 2–8× on V8 (merge per join row
  3.9×, extend-1-var 8.2×) — keep records unless a static build is actually
  committed to.
- **#146**: decimal strings are 2.2× (decimals) / 7× (integers) slower than
  BigInt but exact; the open direction is a hybrid f64 fast path (±2^53) with
  single-pass scale alignment.

The `scratch/` copies these were developed from live outside the repo; the
issues still reference those paths. If this PR merges, point the issue
references at `prototypes/`.

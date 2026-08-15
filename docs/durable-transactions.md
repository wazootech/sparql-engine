---
title: Durable Transactions (SQLite Backend)
layout: default
---

# Durable transaction backend for SPARQL updates

Status: **released** — `SqliteStore` ships as the opt-in
`@wazoo/sparql-engine/sqlite` subpath entrypoint, with a crash-recovery suite
and measured benchmarks behind it (issue #56).

## Goal

Run SPARQL UPDATE requests as atomic, restart-safe transactions against a
durable store, while keeping the published engine runtime **dependency-free**
(no npm packages in the engine's export graph).

## Why the engine already supports this

[`WazooSparqlEngine`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlEngine)
has a `createTransaction` hook
([`WazooSparqlTransaction`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlTransaction)):

```ts
interface WazooSparqlTransaction {
  add(quad: rdfjs.Quad): unknown; // buffer an insert
  delete(quad: rdfjs.Quad): unknown; // buffer a delete
  commit(): Promise<void>; // persist the patch atomically
  rollback(): void; // discard the patch
}
```

`UpdateEvaluator.executeUpdate` creates **one** transaction per update request,
routes every operation's writes through it, then commits once — so a
multi-operation update (`INSERT DATA {…}; DELETE WHERE {…}`) is already
all-or-nothing at the engine level. `SqliteStore` is the durable implementation
of that interface.

## [`SqliteStore`](https://github.com/wazootech/sparql-engine/blob/main/src/store/sqlite-store.ts)

`SqliteStore` (`src/store/sqlite-store.ts`) is an RDF/JS Store + transaction
factory backed by Deno/Node's built-in `node:sqlite` (`DatabaseSync`), shipped
behind the `./sqlite` subpath entrypoint — importing the package default pulls
nothing new, and only opting in loads `node:sqlite`:

```ts
import { SqliteStore } from "@wazoo/sparql-engine/sqlite";

const store = new SqliteStore({ path: "data.sqlite" });
const engine = new WazooSparqlEngine({
  store,
  createTransaction: () => store.createTransaction(),
});
```

**Runtime requirements:** Deno ≥ 2.1 or Node ≥ 22.5 (where `node:sqlite`
exists). On unsupported runtimes the import itself fails with the runtime's
module-not-found error. Browser/edge bundles never see it: a bundler that
imports only `@wazoo/sparql-engine` (or any subpath except `./sqlite`) does not
pull `node:sqlite`; in-memory workloads should keep using `MemoryStore`.

### Schema

```
quads(skey, pkey, okey, gkey, payload)
  PRIMARY KEY (skey, pkey, okey, gkey)   -- all four positions, so quads that
                                          -- differ only by graph never collide
  INDEX (pkey), (okey), (gkey)           -- pattern scans
  STRICT                                 -- typed columns
```

- The four key columns hold
  [`termKey`](https://jsr.io/@wazoo/sparql-engine/doc/~/termKey) of each
  position — the engine's own sound RDF-term equality key
  (`src/term/identity.ts`), so lookups and the in-memory store agree on
  identity, including RDF 1.2 triple terms.
- `payload` is a lossless JSON encoding of the quad (term type, value, literal
  language + datatype, RDF-star nesting) so `match()` reconstructs exact terms —
  a `"hola"@es` literal round-trips with its language intact.

### Transaction semantics

- `commit()` runs `BEGIN IMMEDIATE … COMMIT`. `BEGIN IMMEDIATE` takes the write
  lock up front, so two concurrent updates cannot interleave; a thrown error
  (from any insert/delete or the `beforeCommit` seam) triggers `ROLLBACK` and
  rethrows — the dataset is untouched.
- `PRAGMA busy_timeout = 5000` lets a second concurrent writer wait for the lock
  instead of failing with `SQLITE_BUSY` (verified by the concurrent-writer
  recovery test).
- Deletes apply before inserts; an `add`+`delete` of the same quad nets to the
  add, a `delete`+`add` nets to nothing. This matches the patch semantics the
  update evaluator already assumes for in-memory stores.
- `rollback()` discards the buffer; because nothing touches the database until
  `commit()`, a rollback is trivially safe.
- Reads (`match`/`countQuads`) run outside the transaction, so concurrent
  queries see the pre-commit snapshot until the commit lands — no dirty reads.

### Durability and crash safety

- `PRAGMA journal_mode = WAL`: writes survive process crashes; readers never
  block on a writer.
- `synchronous=FULL` (the default) fsyncs each commit — a committed update
  survives power loss. A deployment can trade some durability for throughput
  with `PRAGMA synchronous = NORMAL` (≈1.5× commit throughput in the benchmark
  below).
- A commit that completes survives `close()` **and** a hard process exit without
  `close()` — proven by the crash-recovery suite, which kills real child
  processes at the failure points:

| Scenario                                   | Child behavior                          | On reopen                          |
| ------------------------------------------ | --------------------------------------- | ---------------------------------- |
| Committed update, hard exit (no `close()`) | commit, then `Deno.exit(0)`             | quad intact                        |
| Buffered writes, exit before `commit()`    | transaction buffer, then `Deno.exit(1)` | dataset untouched                  |
| Kill mid-`BEGIN IMMEDIATE`                 | raw WAL frames, never committed         | interrupted txn rolled back        |
| Two concurrent writers (`busy_timeout`)    | interleaved commit batches              | both datasets complete, no partial |

## Verified behavior (tests)

- Term fidelity: language-tagged, typed, and RDF-star triple-term literals
  round-trip exactly.
- Graph-distinct keys: same s/p/o in three graphs stays three rows.
- Restart durability: updates written through the engine, then the file is
  reopened with a fresh store + engine, and `SELECT` returns the data.
- Atomic multi-op updates: one request with two `INSERT DATA` operations lands
  both or neither.
- Failed commit: the `beforeCommit` test seam throws inside the transaction —
  every buffered write rolls back and the file stays empty.
- Add/delete netting and `deleteGraph` scoping.
- Crash recovery: `src/store/sqlite-store-recovery.test.ts` (child-process suite
  above) + the 8 unit tests in `src/store/sqlite-store.test.ts`.

## Benchmark: SqliteStore vs MemoryStore

`deno task bench:sqlite` (`bench/sqlite_bench.ts`) times each operation on a
freshly seeded store with only the operation inside the timer (10k-quad dataset,
avg of 5 runs; dev machine, 2026-08-15 — see `bench/baseline.json`). Ratios are
the durable-store cost story; CI runners are roughly 3× slower in absolute
terms.

| operation                       | memory  | sqlite    | ratio |
| ------------------------------- | ------- | --------- | ----- |
| bulk load 10k (addQuad)         | 40.9 ms | 16 204 ms | 396×  |
| bulk load 10k (one transaction) | 40.9 ms | 732 ms    | 18×   |
| match all 10k                   | 0.7 ms  | 106 ms    | 163×  |
| match single-predicate 10k      | 0.6 ms  | 72 ms     | 115×  |
| match graph-scoped 10k          | 0.1 ms  | 45 ms     | 402×  |
| countQuads 10k                  | 0.1 ms  | 89 ms     | 617×  |
| engine INSERT DATA ×200         | 11.6 ms | 177 ms    | 15×   |
| engine DELETE WHERE ×100        | 65.0 ms | 3 287 ms  | 51×   |
| commit 1k (10×100) FULL         | —       | 52.5 ms   | —     |
| commit 1k (10×100) NORMAL       | —       | 34.1 ms   | 1.5×  |

Read this as: **batch the writes**. Bulk loading through the engine's
transaction hook is 22× faster than autocommit per-quad (one fsync per
transaction vs one per row). The read paths pay payload-decode amplification —
every `match` row is `JSON.parse`d and rebuilt into terms — which is why pattern
scans are the durable store's dominant cost. WHERE-form updates (`DELETE WHERE`
/ `DELETE/INSERT`) pay that amplification per scanned pattern; if you can
express the workload as `INSERT DATA`/`DELETE DATA` (constant templates), you
avoid it entirely.

## Packaging

`node:sqlite` is a Node/Deno builtin, so `SqliteStore` is server-only. It ships
as the `./sqlite` subpath export; `src/mod.ts` (the default export) is unchanged
and its graph stays free of `node:`/`npm:` imports. Two CI gates enforce the
contract: `deno publish --dry-run` (every export resolves) and
`deno task publish:check` (`test/publish-graph-check.ts` — the default graph has
no `node:`/`npm:` runtime imports, and `./sqlite` pulls exactly `node:sqlite`).
`deno task bench:check` carries two SqliteStore sanity budgets (transactional
load + full match) as the CI regression gate.

## Alternatives considered

| Backend                      | Pros                                       | Cons                                  |
| ---------------------------- | ------------------------------------------ | ------------------------------------- |
| `node:sqlite` (chosen)       | Built-in, zero deps, full SQL transactions | Node/Deno only                        |
| `@libsql/client`             | Works in browsers (wasm), remote replicas  | Adds an npm dependency tree           |
| Deno KV (`Deno.openKv`)      | Built-in, atomic transactions, remote sync | Deno-only, eventual-consistency story |
| Postgres via `node:postgres` | Mature, server-side                        | Heaviest integration                  |

The engine-side contract
([`WazooSparqlTransaction`](https://jsr.io/@wazoo/sparql-engine/doc/~/WazooSparqlTransaction))
is intentionally minimal (add/delete/commit/rollback), so any of these can slot
in without engine changes.

## Next steps

1. `INSERT … ON CONFLICT` batching (single statement per commit) once
   transaction sizes grow.
2. Optional `synchronous` mode on `SqliteStoreOptions` (default `FULL`), instead
   of the store-level pragma the benchmark flips today.
3. A `busy_timeout` option (currently a fixed 5000 ms default).

# Durable transaction backend for SPARQL updates

Status: **prototype implemented** — `src/store/sqlite-store.ts` (with tests in
`src/store/sqlite-store.test.ts`).

## Goal

Run SPARQL UPDATE requests as atomic, restart-safe transactions against a
durable store, while keeping the published engine runtime **dependency-free**
(no `n3`, no SQLite npm package in the engine's export graph).

## Why the engine already supports this

`WazooSparqlEngine` has a `createTransaction` hook (`WazooSparqlTransaction`):

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
all-or-nothing at the engine level. The missing piece is a _durable_
implementation of that interface.

## Prototype: `SqliteStore`

`SqliteStore` (`src/store/sqlite-store.ts`) is an RDF/JS Store + transaction
factory backed by Deno/Node's built-in `node:sqlite` (`DatabaseSync`):

```ts
const store = new SqliteStore({ path: "data.sqlite" });
const engine = new WazooSparqlEngine({
  store,
  createTransaction: () => store.createTransaction(),
});
```

### Schema

```
quads(skey, pkey, okey, gkey, payload)
  PRIMARY KEY (skey, pkey, okey, gkey)   -- all four positions, so quads that
                                          -- differ only by graph never collide
  INDEX (pkey), (okey), (gkey)           -- pattern scans
  STRICT                                 -- typed columns
```

- The four key columns hold `termKey` of each position — the engine's own sound
  RDF-term equality key (`src/term/identity.ts`), so lookups and the in-memory
  store agree on identity, including RDF 1.2 triple terms.
- `payload` is a lossless JSON encoding of the quad (term type, value, literal
  language + datatype, RDF-star nesting) so `match()` reconstructs exact terms —
  a `"hola"@es` literal round-trips with its language intact.

### Transaction semantics

- `commit()` runs `BEGIN IMMEDIATE … COMMIT`. `BEGIN IMMEDIATE` takes the write
  lock up front, so two concurrent updates cannot interleave; a thrown error
  (from any insert/delete or the `beforeCommit` seam) triggers `ROLLBACK` and
  rethrows — the dataset is untouched.
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
- SQLite's default `synchronous=FULL` in WAL mode fsyncs each commit — a
  committed update survives power loss. (A production deployment can trade some
  durability for throughput with `synchronous=NORMAL`.)
- A commit that completes survives `close()` and reopening the file with a
  brand-new `SqliteStore` — covered by the "data persists across store reopen"
  test.

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

## Packaging decision

`node:sqlite` is a Node/Deno built-in, so `SqliteStore` is server-only and is
**not exported from `src/mod.ts`** — the browser/edge export graph keeps zero
runtime dependencies (`deno publish --dry-run` stays clean). It ships as a
deep-import module today; before general release it should move to its own
entrypoint (e.g. `./sqlite`) or a separate package.

## Type-resolution note

The repo's lockfile pinned `@types/node@18` transitively, which predates
`node:sqlite` typings, so `deno.json` now maps `@types/node` to `^22.10.0`. That
import is only referenced by the opt-in module and never reaches the published
package.

## Alternatives considered

| Backend                      | Pros                                       | Cons                                  |
| ---------------------------- | ------------------------------------------ | ------------------------------------- |
| `node:sqlite` (chosen)       | Built-in, zero deps, full SQL transactions | Node/Deno only                        |
| `@libsql/client`             | Works in browsers (wasm), remote replicas  | Adds an npm dependency tree           |
| Deno KV (`Deno.openKv`)      | Built-in, atomic transactions, remote sync | Deno-only, eventual-consistency story |
| Postgres via `node:postgres` | Mature, server-side                        | Heaviest integration                  |

The engine-side contract (`WazooSparqlTransaction`) is intentionally minimal
(add/delete/commit/rollback), so any of these can slot in without engine changes
— the SQLite prototype is the reference implementation.

## Next steps (not in this PR)

1. Export `SqliteStore` from a dedicated `./sqlite` entrypoint.
2. Decide fsync policy (`synchronous=NORMAL` vs `FULL`) and add a
   `busy_timeout`/retry policy for concurrent writers.
3. Benchmark update throughput vs the in-memory store.
4. Consider `INSERT … ON CONFLICT` batching (single statement per commit) once
   transaction sizes grow.

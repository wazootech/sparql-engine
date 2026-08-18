---
title: Durable Transactions (SQLite Backend)
layout: default
---

# Durable transaction backend for SPARQL updates

Status: **moved** — the durable `node:sqlite` store that this page documented
left this repository on 2026-08-17. `SqliteStore` now ships from
[`@worlds/sqlite`](https://github.com/wazootech/worlds-sqlite), packaged with
the worlds impl (the same way `LibsqlRdfjsStore` ships in `@worlds/libsql`).

The full design doc — schema, transaction semantics, crash-recovery matrix,
verified behavior, and cost story — now lives at
[`@worlds/sqlite` `docs/durable-transactions.md`](https://github.com/wazootech/worlds-sqlite/blob/main/docs/durable-transactions.md).

What remains engine-side is the contract, unchanged:

```ts
// @wazoo/sparql-engine — WazooSparqlEngineOptions.createTransaction
interface WazooSparqlTransaction {
  add(quad: rdfjs.Quad): unknown; // buffer an insert
  delete(quad: rdfjs.Quad): unknown; // buffer a delete
  commit(): Promise<void>; // persist the patch atomically
  rollback(): void; // discard the patch
}
```

Wire the store through it:

```ts
import { SqliteStore } from "@worlds/sqlite";

const store = new SqliteStore({ path: "data.sqlite" });
const engine = new WazooSparqlEngine({
  store,
  createTransaction: () => store.createTransaction(),
});
```

The engine's export graph remains free of `node:`/`npm:` runtime imports — only
opting into `@worlds/sqlite` loads `node:sqlite`.

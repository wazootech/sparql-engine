# Glossary

- **WazooSparqlEngine** — the in-repo SPARQL engine; the subject of this effort.
  Must be observably interchangeable with the parity reference.
- **SparqlEngineInterface** — the shared execution contract
  (`execute(request) => Promise<SparqlResponse>`) that `WazooSparqlEngine`
  implements and `@worlds/sdk`'s durable client factories wire into every `Sdk`.
  The interface is duplicated identically in `@worlds/sdk` under an
  identical-spec policy; reconcile any drift deliberately.
- **ComunicaSparqlEngine** — the retired `@worlds/sdk` adapter
  (`@worlds/sdk/comunica`) that `WazooSparqlEngine` used to mirror as a drop-in
  replacement. The SDK removed the adapter on 2026-08-17; Comunica now lives on
  only as a parity reference in this repo's differential harness.
- **Parity reference** — the installed `@comunica/query-sparql-rdfjs-lite`
  (5.3.0) that the wazoo engine is measured against. The porting surface is the
  lite config (`config-rdfjs-lite-v5-1-3.json` in the Comunica monorepo).
- **Differential parity** — the harness's deep comparison of SELECT bindings,
  CONSTRUCT quads, ASK booleans, and final update store contents across engines
  on identical inputs. A feature is "done" only when it agrees differentially.
- **Spec-wins divergence** — when the parity reference contradicts the SPARQL
  spec (e.g. `LIMIT 0` ignored, malformed regex throws), the wazoo engine
  implements the spec, documents the divergence, and skips the parity case.
- **Superset directive** — the standing rule that anything the parity reference
  can do, the wazoo engine must do; parity is the floor. The **superset
  ceiling** is the as-yet-uncharted question of which features beyond that floor
  the wazoo engine should carry.
- **In-repo parser** — the parser module the wazoo engine owns (`src/parser/`):
  a maintained sparqljs 3.7.4 grammar, extended in-repo with the SPARQL 1.2
  surface, no longer a runtime dependency.
- **Pattern-evaluation hook** — the injected seam that lets the pure expression
  layer evaluate graph patterns (for `EXISTS`/`NOT EXISTS`):
  `evaluateExists(pattern, solution) => boolean`, bound to the current graph
  scope and active dataset.
- **Correlated evaluation** — a pattern evaluated with the outer solution's
  bindings visible inside; inner bindings are discarded and fresh inner
  variables never leak out.

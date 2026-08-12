# W3C SPARQL 1.1 differential runner

Runs the vendored W3C SPARQL 1.1 evaluation-core suite **differentially**: every
query and update executes through both `@comunica/query-sparql-rdfjs-lite` and
the native `WazooSparqlEngine` over identical stores, and the observable results
(SELECT bindings, CONSTRUCT quads, ASK booleans, final update store contents)
are compared. This is the shared fixture base adopted by the wayfinder decision
"Decide whether to adopt the W3C SPARQL 1.1 suite as the shared fixture base".

## Run

```bash
deno task test:w3c
```

The runner prints a report and exits nonzero while **parity gaps** remain:

- **pass** — both engines agree.
- **gap** — native and comunica disagree on an in-scope test; each gap is a
  tracked parity defect. The gap count is the progress metric.
- **error** — the runner itself failed on a test.
- **allowlisted** — a gap covered by an entry in
  [`divergences.ts`](./divergences.ts) with a documented reason (reserved for
  decided Comunica bugs where native is spec-correct — never for unimplemented
  surface).
- **conformance** — a soft, never-gating cross-check of the spec-expected result
  where it is parseable (update post-states and CONSTRUCT result files are TTL;
  SELECT/ASK SPARQL XML/JSON results are not parsed).

A CI job (`w3c-parity` in `.github/workflows/ci.yml`) runs the gate on every
push; it stays red until the gap count reaches zero. The default `deno test`
does **not** include this suite.

## Scope

The evaluation core per the adoption decision — query categories (aggregates,
bind, bindings, cast, construct, exists, functions, grouping, negation,
project-expression, property-path, subquery) and update categories (add,
basic-update, clear, copy, delete, delete-data, delete-insert, delete-where,
drop, move, update-silent). Excluded, per the decision's out-of-scope rulings:
entailment regimes, protocol / SERVICE / graph-store, result formats, and syntax
tests.

## Vendored fixtures and re-fetching

`fixtures/sparql11/` holds a snapshot of the W3C rdf-tests evaluation core (~2.6
MB, 336 tests across 23 categories) fetched from the upstream `w3c/rdf-tests`
gh-pages branch. Committing the fixtures keeps CI deterministic and
offline-capable; queries and data resolve against canonical
`http://www.w3.org/2009/sparql/docs/tests/data-sparql11/...` URLs so relative
IRIs (including the empty IRI `<>`) resolve identically in both engines.

To refresh the snapshot:

```bash
# 1. Download the upstream tree.
curl -L https://github.com/w3c/rdf-tests/archive/refs/heads/gh-pages.tar.gz -o /tmp/rdf-tests.tar.gz
tar -xzf /tmp/rdf-tests.tar.gz -C /tmp

# 2. Replace the vendored evaluation-core categories.
#    SRC=/tmp/rdf-tests-gh-pages/sparql/sparql11
#    DST=test/w3c/fixtures/sparql11
#    cp -r "$SRC"/{aggregates,bind,bindings,cast,construct,exists,functions,grouping,
#                negation,project-expression,property-path,subquery,add,basic-update,
#                clear,copy,delete,delete-data,delete-insert,delete-where,drop,move,
#                update-silent} "$DST/"

# 3. Remove any stray top-level files (index pages, template.haml, *.jsonld).
# 4. Run `deno task test:w3c` and review the gap count before committing.
```

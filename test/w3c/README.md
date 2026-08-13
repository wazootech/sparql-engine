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
- **documented divergence** — a test keyed in
  [`divergences.ts`](./divergences.ts) with a documented reason (reserved for
  decided Comunica bugs where native is spec-correct — never for unimplemented
  surface). These are validated against the W3C reference result (result-set TTL
  for SELECT, an empty store for the SILENT update cases) instead of against
  Comunica, so a spec-correct native result **passes**.
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

# RDF 1.1 / 1.2 syntax gates

The native Turtle / TriG / N-Triples / N-Quads grammar used by SPARQL `LOAD`
(`src/parser/turtle-parser.ts`) is gated against the W3C rdf-tests suites with
two runners, both invoked from `deno task ci`:

- `deno task test:rdf11` — **RDF 1.1 differential** (`rdf-differential.ts`).
  Every Turtle / TriG / N-Triples / N-Quads syntax and eval test is parsed with
  both the native grammar and `n3@2.2.0`; the two must agree on accept/reject
  and on the resulting quads (up to blank-node relabeling). Negative tests are
  additionally gated absolutely — native must reject them even if n3 is lenient.
  Eval tests are also gated against their `.nt`/`.nq` reference result (parsed
  with the native grammar), so a native+n3 agreement on the wrong quads still
  fails.
- `deno task test:rdf12` — **RDF 1.2 manifest classifier** (`rdf-classify.ts`).
  n3 predates RDF 1.2 triple terms and reifiers, so each positive syntax test
  must parse, each negative syntax test must be rejected, and each eval test
  must produce quads isomorphic to its `.nt`/`.nq` reference (parsed with the
  native grammar, which is a superset of N-Triples/N-Quads).

Both gates are expected to be green. The only tolerated mismatches are
documented divergences keyed inside each runner:

- **Superset acceptances** — the native grammar is a single Turtle + TriG +
  N-Quads superset (LOAD content-sniffs the format rather than trusting the file
  extension), so it accepts Turtle/TriG/N-Quads constructs in files where the
  strict N-Triples/N-Quads/Turtle/TriG grammar rejects them. Everything else
  must be fixed, never allowlisted.

### Reference-engine cross-check (`deno task test:ref`)

`ref-crosscheck.ts` audits every allowlisted divergence against two independent
reference engines and fails if any of them is accepted by native but rejected by
every lenient reference:

- **Oxigraph** (`npm:oxigraph`, Rust/WASM) — format-strict. Checked in both the
  file's strict format and the superset format content-sniffing would select.
- **N3.js in RDF-star mode** (`npm:n3@1.26.0` with the `+ "*"` format suffix) —
  the engine behind `@comunica`'s `rdf-parse` (which passes `mediaType + "*"` to
  enable RDF-star syntax in every format), i.e. the lenient, content-sniffing
  reference. The synchronous API is used because rdf-parse's streaming path
  throws an _uncaught_ null-deref on some malformed RDF 1.2 inputs
  (`nquads12-nested-bad-annotated-syntax-1`); sync N3 raises the same error
  catchably.

Current result: **45/45 allowlisted cases endorsed** (RDF 1.1: 32, RDF 1.2: 13).
Every construct native accepts is genuine Turtle/TriG 1.1/1.2 syntax or RFC 3986
IRI resolution:

- Turtle constructs in `.nt`/`.nq` files (relative IRIs, `@prefix`/`@base`,
  object lists, numeric and long-string shorthands) — accepted by Oxigraph's
  Turtle parser and by N3-RDF-star; rejected only by the strict N-Triples /
  N-Quads grammars.
- RDF 1.2 constructs in `.nt`/`.nq` files: old-style `<< s p o >>` reified
  triples and `{| |}` annotations (including on blank-node triples and nested
  annotations) — all accepted by Oxigraph's Turtle 1.2 parser; the W3C negative
  tests exist because the N-Triples / N-Quads 1.2 grammars contain no annotation
  production at all, not because the constructs are invalid.
- `ntriples12-bad-iri-1` (`<//example/missing-scheme>`) — RFC 3986 network-path
  reference, accepted by Oxigraph-Turtle exactly as native's RFC 3986 resolver
  handles it.
- `.nq` files whose Oxigraph/TriG rejection is only about graph-name placement
  (`<g>.` after a triple/annotation, which TriG cannot express) — the same
  content with graph names stripped parses under Oxigraph-Turtle.

So none of the allowlisted cases requires "unholding": tightening the grammar
would mean making `LOAD` format-strict, contradicting its content-sniffing
design, and would reject constructs every reference engine accepts in the
corresponding format. Re-run the audit any time the grammar or the allowlists
change: `deno task test:ref`.

## Vendored fixtures and re-fetching

`fixtures/rdf/` holds the RDF 1.1 and 1.2 Turtle, TriG, N-Triples, and N-Quads
suites (~2.5 MB) from the upstream `w3c/rdf-tests` gh-pages branch, with the
`reports/`, `c14n/`, `index.html`, and `manifest.jsonld` files stripped. On-disk
paths map 1:1 to canonical `https://w3c.github.io/rdf-tests/rdf/...` URLs, so
relative IRIs in the test files resolve exactly as the W3C harness resolves
them.

To refresh the snapshot:

```bash
# 1. Download the upstream tree.
curl -L https://github.com/w3c/rdf-tests/archive/refs/heads/gh-pages.tar.gz -o /tmp/rdf-tests.tar.gz
tar -xzf /tmp/rdf-tests.tar.gz -C /tmp
SRC=/tmp/rdf-tests-gh-pages/rdf
DST=test/w3c/fixtures/rdf

# 2. Replace each suite, excluding reports/c14n/index pages.
for v in rdf11 rdf12; do
  for d in rdf-turtle rdf-trig rdf-n-triples rdf-n-quads; do
    mkdir -p "$DST/$v/$d"
    (cd "$SRC/$v/$d" && tar --exclude=reports --exclude=c14n \
        --exclude=index.html --exclude=manifest.jsonld --exclude=README.md \
        -cf - .) | tar -xf - -C "$DST/$v/$d"
  done
done

# 3. Run both gates and review any new gaps before committing.
deno task test:rdf11
deno task test:rdf12
```

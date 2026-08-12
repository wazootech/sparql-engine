# Vendored SPARQL parser

A vendored copy of the **sparqljs** SPARQL 1.1 parser, maintained by this
project as a standalone module, extended with the SPARQL 1.2 direction-function
surface that upstream's grammar does not whitelist.

## Why this exists

The parity contract is behavioral equivalence with
`@comunica/query-sparql-rdfjs-lite`, and the target is a superset: anything
Comunica can run, the native engine must run. Comunica 5.x parses SPARQL with
`@traqula/parser-sparql-1-2`, which accepts `LANGDIR(...)` — but the native
engine's sparqljs 3.7.4 grammar rejects **all four** SPARQL 1.2
direction-function names (they are not in its builtin whitelist), so `LANGDIR`
was a real, reachable parity gap: Comunica ran it, native could not even parse
it.

Rather than depend on upstream sparqljs's release cadence, the parser is
vendored here and patched in-place. The patch is deliberately tiny: a pure lexer
whitelist extension, so the existing generated grammar productions handle the
new names with no grammar surgery.

## What is vendored

| File          | Origin                                 | Notes                                                                                                                         |
| ------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `parser.cjs`  | `sparqljs@3.7.4` `lib/SparqlParser.js` | Generated jison parser, patched (see below). Its only runtime dependency is `./Wildcard`.                                     |
| `Wildcard.js` | `sparqljs@3.7.4` `lib/Wildcard.js`     | Upstream file, unmodified. Kept with its upstream filename because `parser.cjs` does `require('./Wildcard')` (extensionless). |
| `mod.ts`      | ours                                   | The maintained wrapper: extends the generated parser and exports the `Parser` class used by the engine.                       |
| `LICENSE`     | `sparqljs@3.7.4` (MIT)                 | Upstream license, required for redistribution.                                                                                |

The generated parser's term construction needs an RDF/JS `DataFactory`
(`blankNode`, `literal`, `namedNode`, `quad`, `variable`). Upstream uses
`rdf-data-factory`; this module uses N3's `DataFactory` (already a project
dependency). AST shapes are identical to upstream sparqljs — this module is a
drop-in replacement for the `sparqljs` `Parser` export.

## The patch (SPARQL 1.2 direction functions)

sparqljs's jison grammar whitelists builtin functions as lexer rules grouped by
arity token (`FUNC_ARITY0/1/2/3`). The grammar productions build `functionCall`
AST nodes generically from the lexed text (lowercased), so extending the
whitelist is a lexer-only change. Three rules were modified (rule indices and
their `performAction` case numbers are unchanged):

| Function                                         | Arity | Rule              | Change                                  |
| ------------------------------------------------ | ----- | ----------------- | --------------------------------------- |
| `LANGDIR(simpleLiteral)`                         | 1     | FUNC_ARITY1 group | added `LANGDIR` **before** `LANG`       |
| `hasLang(langString, language)`                  | 2     | FUNC_ARITY2 group | appended `hasLang`                      |
| `STRLANGDIR(simpleLiteral, language)`            | 2     | FUNC_ARITY2 group | added `STRLANGDIR` **before** `STRLANG` |
| `hasLangDir(langDirString, language, direction)` | 3     | FUNC_ARITY3 rule  | added `hasLangDir` to the `IF` rule     |

Two lexer subtleties matter here:

1. **Ordered alternation within a rule.** JavaScript regex alternation is
   first-match, not longest-match. `LANGDIR` must appear before `LANG`, and
   `STRLANGDIR` before `STRLANG`, or the shorter name lexes first and the
   remainder of the input becomes `INVALID`.
2. **Longest match across rules.** The lexer tests rules in order and keeps the
   longest match, so `hasLangDir` (its own rule) wins over `hasLang`, and
   `LANGMATCHES` over `LANG`. Existing behavior is unaffected.

Parse results (AST names are lowercased, matching sparqljs convention):

```ts
LANGDIR("hello")                -> { type: "functionCall", name: "langdir", args: [..] }
hasLang("hello", "en")          -> { type: "functionCall", name: "haslang", args: [..] }
STRLANGDIR("hello", "en")       -> { type: "functionCall", name: "strlangdir", args: [..] }
hasLangDir("hello", "en", "ltr")-> { type: "functionCall", name: "haslangdir", args: [..] }
```

Out of scope for the patch: the variadic `hasLang(simpleLiteral)` and
`hasLang(simpleLiteral, language, direction)` forms (arity tokens are fixed).
Neither sparqljs nor traqula can express them, so they are unreachable in both
engines; they would require real grammar surgery if ever needed.

## Re-vendoring / upgrading

1. Copy `lib/SparqlParser.js` → `parser.cjs` and `lib/Wildcard.js` →
   `Wildcard.js` from the target `sparqljs` version.
2. Re-apply the three lexer changes above (same rule names; verify the rule
   indices still line up with the `performAction` cases if the upstream grammar
   changed).
3. Update this README's version table and `LICENSE` if upstream changed.

## Gotcha: Deno's V8 bytecode cache

Deno caches compiled module code under its cache dir (`DENO_DIR`), and after
editing `parser.cjs` Deno can keep executing the stale compiled copy — the
symptoms are puzzling lexer/parser failures while `node` on the same file works,
and `--reload` does **not** clear it. If the parser behaves as if the patch is
missing, clear Deno's `v8_code_cache_v2*` files (or point `DENO_DIR` at a fresh
directory) and re-run. This bit us once; expect it on every future edit to
`parser.cjs`.

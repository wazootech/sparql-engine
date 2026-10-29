# AI agent coding guidelines

This document serves as the authoritative behavioral and stylistic manual for
all AI Agents writing code in this repository.

## Workspace boundary

This repository is the `@wazoo/sparql-engine` package, an independent child
repository in the Wazoo multi-repo workspace.

## Declarative clarity and naming conventions

- **Zero cryptic abbreviations:** Never utilize ambiguous shorthand (`rs`,
  `res`, `q`, `err`). Use `resultSet`, `response`, `quad`, `error`.
- **Direct file-symbol alignment:** Source filenames must match exported primary
  symbols using lowercase kebab-case (e.g. `wazoo-sparql-engine.ts`).
- **JSDoc semantics:** JSDoc comments for all exported symbols MUST begin
  directly with the symbol's exact name.

## Import path conventions

- **In-repo imports:** Use `@/` mapped to `./src/`.
- **Public exports:** Use `@wazoo/sparql-engine` in consumer packages, never
  `@/`.

## Docs maintenance (wiki sync)

We keep `docs/` in sync with the source tree using the wiki skill's sync
reference (`repos/wiki/skills/wiki/references/sync.md` in the Wazoo wiki
toolchain repo). This wiki uses the drift-free default: `detail_level: minimal`
— `docs/` carries no line numbers, no machine-specific measurement numbers, and
no test counts. README.md owns the numbers; the wiki keeps structure and
methodology prose. To opt into the detailed style, change this directive to
`line-numbers`, `measurements`, or `full`.

## Verification

Run local checks before staging:

```sh
deno task ci
```

## Code health

Family-wide rules live in the
[wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards);
this repo's specifics:

- Before pushing, run `deno task ci`; CI runs it on every pull request and push
  to `main`.
- `deno lint` enforces `no-explicit-any` and `ban-ts-comment` (no `@ts-ignore`),
  and `deno.json` sets `strict: true`.
- Exempt: the generated `src/parser/parser.ts` and
  `src/parser/turtle-generated.ts` keep their `@ts-nocheck` and
  `deno-lint-ignore-file` headers; regenerate them, never hand-edit. The
  generator tools (`jison`, `ebnf-parser`, `n3`, `n3-rdfstar`) are entries in
  the `deno.json` import map.
- `secret-scan.yml` runs gitleaks on every pull request and push to `main`;
  never commit credentials.
- Workflow actions are pinned to full commit SHAs with a version comment, Deno
  is pinned to `v2.9.8`, and CI installs with `deno install --frozen`, so commit
  any `deno.lock` change.
- `code-health.yml` only warns: files over 120 lines of code (300 for tests) and
  `TODO`/`FIXME` without an issue link. It skips the two generated parsers and
  `playground/app.js`.
- `.github/CODEOWNERS` routes review to the repo owner.

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
bun run ci
```

## Toolchain (Bun)

The toolchain is Bun (cutover tracked in wazootech/workspace#50), and the code
stays Node-compatible:

- Use `node:` APIs, never `Deno.*` (`node:fs`, `node:path`, `node:process`,
  `node:child_process`). A file path from `import.meta.url` goes through
  `fileURLToPath`. The one deliberate host probe is `LOAD`'s default reader in
  `src/evaluator/update-evaluator.ts`, which reaches for `Deno` or `Bun` on
  `globalThis` so the published package works for Deno and Bun consumers.
- Tests use `node:test` (`test`) and `node:assert/strict`; `test/thrown.ts` has
  `thrown`/`rejected` for the value-returning `assertThrows`/`assertRejects`. No
  `@std/assert`, no `bun:test`.
- Benches register with `bench()` from `bench/bench.ts` (mitata) and end with
  `await runBenches()`.
- Spawn the running Bun with `test/run-process.ts` (`scriptCommand`,
  `testCommand`, `compileCommand`), not a hard-coded binary name.
- `jsr.json` is the published package's manifest (name, version, exports,
  imports, `publish` rules); `package.json` and `bun.lock` are what Bun
  installs. `bun run check:manifests` (`scripts/check-manifests.ts`) fails when
  their export maps or dependency ranges drift, so change both together. A
  `jsr:` dependency is an `npm:@jsr/<scope>__<name>` alias in `package.json`,
  resolved through the `@jsr` scope in `bunfig.toml`.
- `bun run ci` is the whole local gate: `bun fmt --check`, Oxlint, `bun check`,
  the manifest check, `parser:check`, `bun test --timeout 120000` (cold comunica
  parity suites need it), the publish-graph check, the bench budget and the
  W3C/RDF/EXISTS gates. Regenerate parsers with `bun run parser:generate`.
- The comunica/traqula `overrides` in `package.json` pin the engine's reference
  output (comunica 5.4 canonicalizes `xsd:decimal` differently); do not bump
  them without a separate parity review.
- Publishing goes through the `jsr` CLI (`bun run publish:dry`, `bunx jsr publish`),
  which bundles its own Deno-based publisher: no Deno install is needed. Its
  slow-type check is stricter than Deno 2.9's, so exported constants need
  explicit types.

## Code health

Family-wide rules live in the
[wazootech workspace constitution](https://github.com/wazootech/workspace/blob/main/AGENTS.md#code-health-standards);
this repo's specifics:

- Before pushing, run `bun run ci`; CI runs it on every pull request and push to
  `main`.
- Oxlint (`.oxlintrc.json`) enforces `no-explicit-any` and `ban-ts-comment` (no
  `@ts-ignore`), and `tsconfig.json` sets `strict: true`.
- Exempt: the generated `src/parser/parser.ts` and
  `src/parser/turtle-generated.ts`; regenerate them, never hand-edit. The
  generator tools (`jison`, `ebnf-parser`, `n3`, `n3-rdfstar`) are entries in
  the `jsr.json` import map.
- `secret-scan.yml` runs gitleaks on every pull request and push to `main`;
  never commit credentials.
- Bun runs on `1.x` in every workflow and CI installs with
  `bun install --frozen-lockfile`, so commit any `bun.lock` change.
- `code-health.yml` fails on a file over 120 lines of code (300 for tests);
  files that were already over it are listed there with a ceiling that only
  shrinks. A `TODO`/`FIXME` without an issue link only warns. It skips the two generated parsers and
  `playground/app.js`.
- `.github/CODEOWNERS` routes review to the repo owner.

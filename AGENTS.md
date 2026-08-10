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
  symbols using lowercase kebab-case (e.g. `native-sparql-engine.ts`).
- **JSDoc semantics:** JSDoc comments for all exported symbols MUST begin
  directly with the symbol's exact name.

## Import path conventions

- **In-repo imports:** Use `@/` mapped to `./src/`.
- **Public exports:** Use `@wazoo/sparql-engine` in consumer packages, never
  `@/`.

## Verification

Run local checks before staging:

```sh
deno task ci
```

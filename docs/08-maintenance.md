---
title: Wiki Maintenance
layout: default
---

# Wiki Maintenance

This wiki is kept in sync with the source tree by a **Git-anchored delta
process** (the approach LangChain's OpenWiki uses for documentation
maintenance): the last-synced commit is the anchor, Git history is diffed
forward, and only the pages the diff touches get edited. The procedure below is
codified as a reusable skill (`wiki-sync` in
`repos/wiki/skills/wiki-sync/SKILL.md` in the Wazoo wiki toolchain repo,
alongside the `wiki` and `wiki-feedback` skills) so syncing docs after source
changes is a command, not a prompt.

**This wiki uses the drift-free default (`detail_level: minimal`), declared in
this repo's `AGENTS.md`.** `docs/` carries no line numbers, no machine-specific
measurement numbers, and no test counts — only structure that changes when the
source structure changes. Numbers live in `README.md` (regenerated from
`bench/*-data.json`); the wiki keeps the methodology prose and links there.
Opting into the detailed style (`line-numbers`, `measurements`, or `full` in the
`AGENTS.md` directive) re-enables the "execute to verify" steps marked _opt-in_
below.

## The sync anchor

`docs/.sync-base` holds the commit SHA this wiki was last synced to. The delta
is everything after it:

```bash
BASE=$(cat docs/.sync-base)
git log --oneline "$BASE"..origin/main                    # what changed
git diff --stat "$BASE"..origin/main -- src test bench .github
```

If `.sync-base` is missing, fall back to the last commit that touched `docs/`
(`git log -1 --format=%H -- docs/`) and write a fresh anchor after syncing.

## Step 1 — Read the detail level

```bash
grep -i "detail_level" AGENTS.md   # minimal (default) | line-numbers | measurements | full
```

This repo declares `minimal`. Opted-in levels re-enable the verification
sub-steps marked _opt-in_ below.

## Step 2 — Classify the delta

| Change landed in        | Wiki surface to touch                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `src/**/*.ts`           | `04-source-map.md` symbol inventory (name + role + entrypoint link) + every page citing that file |
| `deno.json` tasks       | `01-quickstart.md` task lists                                                                     |
| `test/**` (new/renamed) | `04-source-map.md` test tables, `05-testing.md` covered areas (counts only when opted in)         |
| `bench/**`              | `04-source-map.md` bench table, `07-benchmarking.md` methodology (numbers only when opted in)     |
| new/removed files       | `04-source-map.md` file inventory                                                                 |
| behavior/fixes          | `02-architecture.md`, `03-api-contracts.md` prose                                                 |
| `.github/workflows/*`   | `05-testing.md` task-table gating column                                                          |

## Step 3 — Verify the symbol graph

Symbol citations are by name, never `L<line>`: root exports link to their JSR
doc page, deep imports to their GitHub blob. `deno doc --json` is a
_verification_ tool — confirm every cited symbol still exists and is publicly
exported:

```bash
deno doc --json src/evaluator/join.ts | python -c "
import json, sys
d = json.load(sys.stdin)
mod = list(d['nodes'].values())[0]
for s in mod['symbols']:
    print(s['name'])
"
```

Drop or relink any symbol not in that list; run the full-tree pass
(`git ls-tree -r --name-only origin/main -- src`) when in doubt.

_Opt-in (`line-numbers` or `full`):_ the v2 schema nests declaration locations;
extract `L<line>` and diff against the documented lines, fixing every drift.

## Step 4 — Verify file inventory

```bash
git ls-tree -r --name-only origin/main -- src test bench .github
```

Compare against the `04-source-map.md` tables: add missing files, delete rows
for removed files, and confirm every path the wiki references resolves.

## Step 5 — Edit, validate, land

- Edit only the pages the classification maps to; apply additions and deletions
  the diff demands.
- In the default style, never introduce `L<line>` citations, number tables, or
  test counts. When the diff adds a benchmark or a test, add the methodology
  prose and link to `README.md`'s Results section instead of duplicating
  numbers.
- Link hygiene: every inline prose mention of an exported symbol links to its
  JSR doc page (`https://jsr.io/@wazoo/sparql-engine/doc/~/<Symbol>`);
  [`serializeJsonResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/json-results.ts)
  /
  [`serializeXmlResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/xml-results.ts)
  and every **deep-import symbol** (anything not in the published root exports —
  parser, store, evaluator, and term internals) link to their GitHub blob
  instead (`https://github.com/wazootech/sparql-engine/blob/main/src/<path>`),
  without line anchors. Link the first prose occurrence per page of
  `@wazoo/sparql-engine` (JSR), `Comunica`, `W3C`, and `SPARQL 1.1`/`SPARQL 1.2`
  (spec TRs); link issue refs to the GitHub issue. Never link inside code fences
  or HTML attributes.
- Drift guardrail: the default style must not pick up drift-prone artifacts. Any
  hit is drift to remove (or a sign the repo should opt into the detailed
  style):

  ```bash
  grep -rnE "\bL[0-9]+\b" docs --include="*.md" | grep -v sync-base || true
  grep -rnE "\b(ms/iter|MiB)\b" docs --include="*.md" || true
  ```

- Validate: `deno fmt --check docs/`, nav/front-matter/link checks (all
  `_data/navigation.yml` targets resolve, every page has front matter),
  `deno task docs:link-check` (external link rot — 404/410 fails), and a
  `pandoc -f gfm -t html` render of each touched page.
- Bump `docs/.sync-base` to the new `origin/main` HEAD.
- Land from a fresh worktree off `origin/main`
  (`git worktree add
  "$PWD/worktrees/sparql-engine/docs-sync" -b docs/sync origin/main`),
  commit only `docs/`, open a PR, merge, and confirm the Pages build reports
  `built` with no error before declaring done.

## Only opted-in numbers drift

The default style needs no periodic sweeps: a 300-line file growth changes
nothing in the wiki. If the `AGENTS.md` directive opts into `line-numbers`,
`measurements`, or `full`, run the full-tree verification passes (Steps 3–4 with
the opt-in sub-steps) every few source merges — incremental passes miss drift
that accumulates in line citations and snapshot tables.

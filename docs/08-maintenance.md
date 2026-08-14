---
title: Wiki Maintenance
layout: default
---

# Wiki Maintenance

This wiki is kept in sync with the source tree by a **Git-anchored delta
process** (the approach LangChain's OpenWiki uses for documentation
maintenance): the last-synced commit is the anchor, Git history is diffed
forward, and only the pages the diff touches get edited. The procedurebelow is
codified as a reusable skill (`wiki-sync` in
`repos/wiki/skills/wiki-sync/SKILL.md` in the Wazoo wiki toolchain repo,
alongside the `wiki` and `wiki-feedback` skills) so syncing docs after source
changes is a command, not a prompt.

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

## Step 1 — Classify the delta

| Change landed in        | Wiki surface to touch                                           |
| ----------------------- | --------------------------------------------------------------- |
| `src/**/*.ts`           | `04-source-map.md` (symbol lines) + every page citing that file |
| `deno.json` tasks       | `01-quickstart.md` task lists                                   |
| `test/**` (new/renamed) | `04-source-map.md` test tables, `05-testing.md` covered areas   |
| `bench/**`              | `04-source-map.md` bench table, `07-benchmarking.md`            |
| new/removed files       | `04-source-map.md` file inventory                               |
| behavior/fixes          | `02-architecture.md`, `03-api-contracts.md` prose               |
| `.github/workflows/*`   | `05-testing.md` task-table gating column                        |

## Step 2 — Rebuild the symbol graph

Line references are generated from `deno doc --json`, never eyeballed. The v2
schema nests declaration locations:

```bash
deno doc --json src/evaluator/join.ts | python -c "
import json, sys
d = json.load(sys.stdin)
mod = list(d['nodes'].values())[0]
for s in mod['symbols']:
    print(f\"{s['name']} L{s['declarations'][0]['location']['line']}\")
"
```

Diff the output against the documented lines and fix every drift. Files grow — a
300-line addition invalidates every line citation in that file, so run the
full-tree pass (`git ls-tree -r --name-only origin/main -- src`) rather than
only the changed files.

## Step 3 — Verify counts by running

Documented counts come from runner output. Comments and README prose have
drifted before (the [W3C](https://www.w3.org/) 1.1 suite was documented as
336/23 while the runner loads 345/31):

```bash
deno task test:w3c          # record printed total/pass (345)
deno task test:sparql12     # 249
deno task test:sparql12:gap # 41
deno test --allow-all src/  # unit count
```

If a runner prints something different from the docs, the docs are wrong.

## Step 4 — Verify file inventory

```bash
git ls-tree -r --name-only origin/main -- src test bench .github
```

Compare against the `04-source-map.md` tables: add missing files, delete rows
for removed files, and confirm every path the wiki references resolves.

## Step 5 — Edit, validate, land

- Edit only the pages the classification maps to; apply additions and deletions
  the diff demands.
- Link hygiene: every inline prose mention of an exported symbol links to its
  JSR doc page (`https://jsr.io/@wazoo/sparql-engine/doc/~/<Symbol>`);
  [`serializeJsonResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/json-results.ts)
  /
  [`serializeXmlResults`](https://github.com/wazootech/sparql-engine/blob/main/src/serialize/xml-results.ts)
  and every **deep-import symbol** (anything not in the published root exports —
  parser, store, evaluator, and term internals) link to their GitHub blob
  instead (`https://github.com/wazootech/sparql-engine/blob/main/src/<path>`),
  without line anchors — the prose already carries the maintained L-numbers.
  Link the first prose occurrence per page of `@wazoo/sparql-engine` (JSR),
  `Comunica`, `W3C`, and `SPARQL 1.1`/`SPARQL 1.2` (spec TRs); link issue refs
  to the GitHub issue. Never link inside code fences or HTML attributes.
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

## Periodic sweeps

Every few source merges, run the full Steps 2–4 pass over the whole tree:
incremental syncs catch what landed, sweeps catch accumulated drift. The last
sweep (2026-08-14, against `dfa6ca1`) renumbered every drifted line in
`04-source-map.md`, added previously undocumented symbols and files, and
corrected the W3C counts — an example of what a sweep turns up.

// docs/link-check.ts — Wiki link-rot gate.
//
// Every external http(s) markdown link in the wiki (README.md + docs/*.md)
// must resolve. This catches the link-rot classes the docs-sync sweep is blind
// to: a JSR doc page for a symbol that was renamed or unpublished, a GitHub
// blob whose file moved, an issue number that was deleted, a spec TR that
// changed path.
//
// Failure policy: hard-fail (exit 1) on 404/410 only — a definitive broken
// link. Everything else that is not a clean 200 (5xx, 429, network errors)
// prints a warning but does not fail the gate, so a transient host outage does
// not red the whole build.
//
// Relative intra-wiki links are intentionally out of scope: they are covered
// by the docs-sync procedure (docs/08) and the live-site crawl, and the root
// README.md and docs/ share a virtual root at publish time, which makes
// on-disk resolution ambiguous.
//
// Run locally: `deno task docs:link-check`.

const FILES = [
  "README.md",
  ...Deno.readDirSync("docs")
    .filter((e) => e.isFile && e.name.endsWith(".md"))
    .map((e) => `docs/${e.name}`),
].sort();

const CONCURRENCY = 12;
const TIMEOUT_MS = 20_000;
const USER_AGENT = "sparql-engine-wiki-link-check";

/** Extract unique external markdown links from a file, skipping code fences. */
function extractLinks(text: string): string[] {
  const links = new Set<string>();
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
      links.add(m[1]);
    }
  }
  return [...links];
}

interface Result {
  url: string;
  status: number;
  error?: string;
}

async function checkUrl(url: string): Promise<Result> {
  // One retry on network/transient failure; a definitive 404 is final.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT },
      });
      return { url, status: res.status };
    } catch (e) {
      if (attempt === 1) return { url, status: 0, error: String(e) };
    }
  }
  return { url, status: 0, error: "unreachable" };
}

// Collect (url -> files that reference it) for reporting.
const byFile = new Map<string, string[]>();
const all = new Set<string>();
for (const f of FILES) {
  const links = extractLinks(Deno.readTextFileSync(f));
  for (const u of links) {
    all.add(u);
    byFile.set(u, [...(byFile.get(u) ?? []), f]);
  }
}

// Check with a bounded-concurrency pool.
const pool = [...all];
const results = new Map<string, Result>();
let cursor = 0;
async function worker() {
  while (cursor < pool.length) {
    const url = pool[cursor++];
    results.set(url, await checkUrl(url));
  }
}
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, pool.length) }, worker),
);

let broken = 0;
let warnings = 0;
for (const [url, r] of [...results].sort((a, b) => a[0].localeCompare(b[0]))) {
  const refs = [...(byFile.get(url) ?? [])].join(", ");
  if (r.status === 404 || r.status === 410) {
    broken++;
    console.error(`FAIL  ${r.status}  ${url}\n      referenced by: ${refs}`);
  } else if (r.status !== 200) {
    warnings++;
    console.warn(
      `warn  ${r.status || "ERR"}  ${url}${
        r.error ? ` (${r.error})` : ""
      }\n      referenced by: ${refs}`,
    );
  } else {
    console.log(`  ok  ${url}`);
  }
}

console.log(
  `\n${results.size} unique links checked across ${FILES.length} files; ${broken} broken, ${warnings} transient warnings.`,
);
if (broken > 0) {
  console.error(
    "Broken wiki links detected. Fix the target or update the docs (see docs/08-maintenance.md).",
  );
  Deno.exit(1);
}

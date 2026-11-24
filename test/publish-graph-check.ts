// publish-graph-check asserts the entrypoint graphs stay runtime-dependency
// free, per the packaging contract (issue #56):
//
//   - The default export (`src/mod.ts`) must not import `node:` builtins —
//     the zero-runtime-dependency claim of the published package.
//   - No bare (npm) value dependency may sneak into the graph. The only
//     allowed bare specifier is the type-only `@rdfjs/types` (erased at
//     compile time).
//
// The durable `node:sqlite` store previously guarded by the `./sqlite`
// subpath check moved to `@worlds/sqlite` (2026-08-17); the engine no longer
// ships a builtin-loading entrypoint, so every export is now pure.
//
// The graph is read statically from the sources (import and export-from
// statements, dynamic `import("...")`), following relative paths and the `@/`
// alias for `./src/`, so the check runs on Deno and Bun alike instead of
// asking `deno info` for the graph.
//
// Run: deno task publish:check (wired into `deno task ci` alongside
// `publish:dry`, which asserts every export resolves).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPE_ONLY_ALLOWED = ["@rdfjs/types"];

/** GraphImports are the specifiers one source file imports as values. */
interface GraphImports {
  /** local holds absolute paths of in-repo modules. */
  local: string[];
  /** external holds every other specifier (node:, bare packages, URLs). */
  external: string[];
}

/** stripComments removes whole-line and block comments so prose is not scanned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** valueSpecifiers lists the specifiers a file loads at runtime (type-only imports are erased). */
function valueSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const specifiers: string[] = [];
  const statements =
    /\b(import|export)\s+(type\s+)?([^;"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(statements)) {
    const [, keyword, typeOnly, , specifier] = match;
    const isStatement = keyword === "import" || match[3] !== undefined;
    if (isStatement && typeOnly === undefined) specifiers.push(specifier);
  }
  for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** classify splits a file's value imports into in-repo modules and external specifiers. */
function classify(file: string): GraphImports {
  const local: string[] = [];
  const external: string[] = [];
  for (const specifier of valueSpecifiers(readFileSync(file, "utf8"))) {
    if (specifier.startsWith("@/")) {
      local.push(join(REPO_ROOT, "src", specifier.slice(2)));
    } else if (specifier.startsWith(".")) {
      local.push(resolve(dirname(file), specifier));
    } else {
      external.push(specifier);
    }
  }
  return { local, external };
}

/** moduleSpecifiers returns every external value specifier in the graph of entry. */
function moduleSpecifiers(entry: string): string[] {
  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = [resolve(REPO_ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const imports = classify(file);
    imports.external.forEach((specifier) => external.add(specifier));
    queue.push(...imports.local);
  }
  return [...external];
}

/** assertPurity checks one entrypoint's graph against the contract. */
function assertPurity(
  entry: string,
  specifiers: string[],
  expectedNode: string[],
): void {
  const nodeImports = [
    ...new Set(
      specifiers.filter((specifier) => specifier.startsWith("node:")),
    ),
  ].sort();
  const foreign = specifiers.filter((specifier) =>
    !specifier.startsWith("node:") && !TYPE_ONLY_ALLOWED.includes(specifier)
  );

  const expected = [...expectedNode].sort();
  if (JSON.stringify(nodeImports) !== JSON.stringify(expected)) {
    throw new Error(
      `${entry}: node: imports ${JSON.stringify(nodeImports)} do not match ` +
        `expected ${JSON.stringify(expected)}`,
    );
  }
  if (foreign.length > 0) {
    throw new Error(
      `${entry}: unexpected package dependencies ${JSON.stringify(foreign)}` +
        " (only type-only @rdfjs/types is allowed)",
    );
  }
}

// The default export must be pure: no node: builtins at all.
const defaultGraph = moduleSpecifiers("src/mod.ts");
assertPurity("src/mod.ts (default export)", defaultGraph, []);

console.log(
  "publish:check — default export graph has no node:/npm: runtime imports.",
);

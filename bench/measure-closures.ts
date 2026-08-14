// Consumer-closure measurement for the README's per-entrypoint footprint
// table (issue #94). For each package entrypoint (the "." full engine plus
// the ./term, ./store, ./parser, ./serialize subpaths) this walks the
// value-import graph — following `import ... from`, `export ... from`,
// side-effect imports, and dynamic import() — while skipping type-only
// specifiers (`import type`, `export type`), which are erased at runtime.
// The reported bytes are the sum of the local .ts files in that closure,
// i.e. what a consumer who imports only that entrypoint loads.
//
// Resolution: "@/x" maps to ./src/x; relative specifiers resolve against the
// importing module; anything else (npm:, jsr:, bare) is external and not
// counted. Specifier parsing is regex-based — fine for this codebase's
// straightforward import forms (barrels included).
//
// Run: deno run --allow-read --allow-write bench/measure-closures.ts
import { dirname, join, resolve } from "@std/path";

const CWD = Deno.cwd();

const ENTRIES = [
  { name: ".", path: "./src/mod.ts" },
  { name: "./term", path: "./src/term/mod.ts" },
  { name: "./store", path: "./src/store/memory-store.ts" },
  { name: "./parser", path: "./src/parser/mod.ts" },
  { name: "./serialize", path: "./src/serialize/mod.ts" },
];

// import x from / import { x } from / import "x" (side effect) / import()
// — with `(?!type\b)` so `import type ... from` is skipped. The export twin
// skips `export type ... from` but keeps `export * from` and `export { ... }`.
const VALUE_IMPORT_RE = /\bimport\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/g;
const VALUE_EXPORT_RE = /\bexport\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpecifier(
  specifier: string,
  importer: string,
): string | null {
  if (specifier.startsWith("@/")) {
    return join(CWD, "src", specifier.slice(2));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolve(dirname(importer), specifier);
  }
  return null; // external (npm:, jsr:, bare specifier) — not counted.
}

function completePath(path: string): string | null {
  try {
    Deno.statSync(path);
    return path;
  } catch {
    // fall through to extension completion
  }
  if (!path.endsWith(".ts")) {
    try {
      Deno.statSync(path + ".ts");
      return path + ".ts";
    } catch {
      // fall through to /mod.ts completion
    }
  }
  try {
    Deno.statSync(join(path, "mod.ts"));
    return join(path, "mod.ts");
  } catch {
    return null;
  }
}

function closureOf(entry: string): { files: string[]; bytes: number } {
  const visited = new Set<string>();
  const queue = [resolve(CWD, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const text = Deno.readTextFileSync(file);
    for (
      const re of [
        VALUE_IMPORT_RE,
        VALUE_EXPORT_RE,
        SIDE_EFFECT_RE,
        DYNAMIC_IMPORT_RE,
      ]
    ) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const target = resolveSpecifier(match[1], file);
        if (target === null) {
          continue;
        }
        const complete = completePath(target);
        if (complete !== null && !visited.has(complete)) {
          queue.push(complete);
        }
      }
    }
  }
  const bytes = [...visited].reduce(
    (sum, file) => sum + Deno.statSync(file).size,
    0,
  );
  const files = [...visited]
    .map((file) => file.slice(CWD.length + 1))
    .sort();
  return { files, bytes };
}

const entries = ENTRIES.map((entry) => ({
  name: entry.name,
  ...closureOf(entry.path),
}));

const result = { generatedAt: new Date().toISOString(), entries };
// Write the machine-readable snapshot for bench/treemap.ts (the closures
// bar chart), then print the human summary.
Deno.writeTextFileSync(
  join(Deno.cwd(), "bench", "closures-data.json"),
  JSON.stringify(result, null, 2) + "\n",
);

for (const entry of entries) {
  console.log(
    `${entry.name.padEnd(12)} ${String(entry.bytes).padStart(8)} B ` +
      `(${(entry.bytes / 1024).toFixed(1)} KiB) in ${entry.files.length} files`,
  );
}

// publish-graph-check asserts the entrypoint graphs stay runtime-dependency
// free, per the packaging contract (issue #56):
//
//   - The default export (`src/mod.ts`) must not import `node:` builtins —
//     the zero-runtime-dependency claim of the published package.
//   - No `npm:` value dependency may sneak into the graph. The single
//     allowed npm: entry is the type-only `@rdfjs/types` (erased at compile
//     time), which `deno info --json` still lists.
//
// The durable `node:sqlite` store previously guarded by the `./sqlite`
// subpath check moved to `@worlds/sqlite` (2026-08-17); the engine no longer
// ships a builtin-loading entrypoint, so every export is now pure.
//
// Run: deno task publish:check (wired into `deno task ci` alongside
// `publish:dry`, which asserts every export resolves).
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

interface GraphModule {
  specifier: string;
}

interface ModuleGraph {
  modules: GraphModule[];
}

/**
 * moduleSpecifiers returns every specifier in the value graph of entry
 * (relative to the repo root). The path is passed relative to the cwd — an
 * absolute path makes `deno info --json` omit node: builtins on Windows.
 */
async function moduleSpecifiers(entry: string): Promise<string[]> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entry],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(
      `deno info failed for ${entry}:\n${new TextDecoder().decode(stderr)}`,
    );
  }
  const graph = JSON.parse(new TextDecoder().decode(stdout)) as ModuleGraph;
  return graph.modules.map((module) => module.specifier);
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
  const npmImports = [
    ...new Set(
      specifiers.filter((specifier) => specifier.startsWith("npm:")),
    ),
  ].sort();

  const expected = [...expectedNode].sort();
  if (JSON.stringify(nodeImports) !== JSON.stringify(expected)) {
    throw new Error(
      `${entry}: node: imports ${JSON.stringify(nodeImports)} do not match ` +
        `expected ${JSON.stringify(expected)}`,
    );
  }
  const foreignNpm = npmImports.filter(
    (specifier) => !specifier.startsWith("npm:/@rdfjs/types@"),
  );
  if (foreignNpm.length > 0) {
    throw new Error(
      `${entry}: unexpected npm: dependencies ${JSON.stringify(foreignNpm)}` +
        " (only type-only @rdfjs/types is allowed)",
    );
  }
}

// The default export must be pure: no node: builtins at all.
const defaultGraph = await moduleSpecifiers("src/mod.ts");
assertPurity("src/mod.ts (default export)", defaultGraph, []);

console.log(
  "publish:check — default export graph has no node:/npm: runtime imports.",
);

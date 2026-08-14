// Library-size measurement for the README's size comparison. Measures what a
// consumer must have on disk for each engine:
//
//   - wazoo:  the JSR publish artifact (src/ + README.md + LICENSE), broken
//              down by top-level module.
//   - oxigraph: the installed npm package, broken down into the WASM binary
//              vs the JS glue.
//   - comunica: @comunica/query-sparql-rdfjs-lite plus its full transitive
//              dependency closure, broken down by the root package's direct
//              dependencies.
//
// Prints one JSON document to stdout; bench/treemap.ts consumes it.
//
// Run: deno run --allow-read bench/measure-libs.ts > bench/size-data.json
import { join } from "@std/path";

interface Sized {
  name: string;
  bytes: number;
  children?: Sized[];
}

function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isDirectory) {
      total += dirBytes(join(dir, entry.name));
    } else {
      total += Deno.statSync(join(dir, entry.name)).size;
    }
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* npm resolution through node_modules/.deno                          */
/* ------------------------------------------------------------------ */

const DENO_DIR = join(Deno.cwd(), "node_modules", ".deno");

/** name -> highest installed version dir, from a scan of .deno. */
const installed = new Map<string, string>();

function scanInstalled(): void {
  for (const entry of Deno.readDirSync(DENO_DIR)) {
    // Key shape: `name@version` with scoped names flattened as `@scope+name`.
    const at = entry.name.lastIndexOf("@");
    if (at <= 0) {
      continue;
    }
    const key = entry.name.slice(0, at);
    const version = entry.name.slice(at + 1);
    const name = key.includes("+") && key.startsWith("@")
      ? key.replace("+", "/")
      : key;
    const dir = join(DENO_DIR, entry.name, "node_modules", name);
    if (!dir.startsWith(DENO_DIR)) {
      continue;
    }
    const existing = installed.get(name);
    if (existing === undefined || version > existing.split("@").at(-1)!) {
      installed.set(name, dir);
    }
  }
}

function measure(name: string): number {
  const dir = installed.get(name);
  if (dir === undefined) {
    return 0;
  }
  const pkg = JSON.parse(Deno.readTextFileSync(join(dir, "package.json"))) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
  return dirBytes(dir) + deps.reduce((sum, dep) => sum + measure(dep), 0);
}

function comunicaArtifact(): Sized {
  const rootName = "@comunica/query-sparql-rdfjs-lite";
  const rootDir = installed.get(rootName);
  if (rootDir === undefined) {
    throw new Error(`comunica not installed; run deno cache first`);
  }
  const rootPkg = JSON.parse(
    Deno.readTextFileSync(join(rootDir, "package.json")),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const directDeps = [
    ...Object.keys(rootPkg.dependencies ?? {}),
    ...Object.keys(rootPkg.optionalDependencies ?? {}),
  ];

  // Cache each package's own bytes, then compute subtree sizes.
  const self = new Map<string, number>();
  const closure = new Set<string>();
  const collect = (name: string): void => {
    if (closure.has(name)) {
      return;
    }
    closure.add(name);
    const dir = installed.get(name);
    if (dir === undefined) {
      return;
    }
    self.set(name, dirBytes(dir));
    const pkg = JSON.parse(
      Deno.readTextFileSync(join(dir, "package.json")),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (
      const dep of [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ]
    ) {
      collect(dep);
    }
  };
  collect(rootName);

  const total = [...closure].reduce(
    (sum, name) => sum + (self.get(name) ?? 0),
    0,
  );

  // Exclusive attribution: each closure package belongs to the direct
  // dependency that reaches it first (in directDeps order), so the child
  // sets partition the closure — a valid treemap hierarchy that sums to
  // the total.
  const depsOf = new Map<string, string[]>();
  for (const name of closure) {
    const dir = installed.get(name);
    if (dir === undefined) {
      continue;
    }
    const pkg = JSON.parse(
      Deno.readTextFileSync(join(dir, "package.json")),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    depsOf.set(name, [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]);
  }
  const attribution = new Map<string, string>(); // package -> owning direct dep
  for (const dep of directDeps) {
    const queue = [dep];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (attribution.has(current) || current === rootName) {
        continue;
      }
      attribution.set(current, dep);
      for (const next of depsOf.get(current) ?? []) {
        queue.push(next);
      }
    }
  }
  const byOwner = new Map<string, number>();
  for (const [name, owner] of attribution) {
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + (self.get(name) ?? 0));
  }
  const children = [...byOwner.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  console.error(
    `comunica closure: ${closure.size} packages, ${total} bytes on disk`,
  );
  return { name: "comunica", bytes: total, children };
}

/* ------------------------------------------------------------------ */
/* wazoo + oxigraph                                                  */
/* ------------------------------------------------------------------ */

/** Files excluded from the JSR artifact via publish.exclude (mirrors
 * deno.json) — build-time grammar sources and unreachable Node-only code.
 * Paths are relative to src/ (the walk below starts at src/). */
const ARTIFACT_EXCLUDED_SUFFIXES = [".test.ts", ".jison"];
const ARTIFACT_EXCLUDED_FILES = [
  "parser/generate-parser.ts",
  "store/sqlite-store.ts",
];

function isExcluded(relPath: string): boolean {
  if (ARTIFACT_EXCLUDED_FILES.includes(relPath)) {
    return true;
  }
  return ARTIFACT_EXCLUDED_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
}

/** artifactFiles lists every file the JSR artifact ships: src/ + README.md +
 * LICENSE, minus the publish.exclude set. */
function artifactFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = join(dir, entry.name);
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory) {
        walk(path, relPath);
      } else if (!isExcluded(relPath)) {
        files.push(path);
      }
    }
  };
  walk(join(Deno.cwd(), "src"), "");
  files.push(join(Deno.cwd(), "README.md"));
  files.push(join(Deno.cwd(), "LICENSE"));
  return files;
}

/** gzipBytesOf compresses the given files and returns the total gzipped size
 * (the "at the wire" transfer figure for the artifact). */
async function gzipBytesOf(files: string[]): Promise<number> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  let total = 0;
  const reader = stream.readable.getReader();
  const drain: Promise<void> = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      total += value.byteLength;
    }
  })();
  for (const file of files) {
    await writer.write(await Deno.readFile(file));
  }
  await writer.close();
  await drain;
  return total;
}

function wazooArtifact(): Sized {
  const root = join(Deno.cwd());
  const files = artifactFiles();
  // Per-file children with POSIX-style names, so the treemap breaks the
  // artifact into its largest files identically on every platform (the
  // layout caps the labeled tiles at 8 + an "other deps" aggregate).
  const children = files
    .map((file) => ({
      name: file.slice(root.length + 1).replaceAll("\\", "/"),
      bytes: Deno.statSync(file).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    name: "wazoo",
    bytes: children.reduce((sum, c) => sum + c.bytes, 0),
    children,
  };
}

function oxigraphArtifact(): Sized {
  const dir = installed.get("oxigraph");
  if (dir === undefined) {
    throw new Error(`oxigraph not installed; run deno cache first`);
  }
  let wasm = 0;
  let glue = 0;
  const walk = (d: string): void => {
    for (const entry of Deno.readDirSync(d)) {
      const path = join(d, entry.name);
      if (entry.isDirectory) {
        walk(path);
      } else {
        const size = Deno.statSync(path).size;
        if (entry.name.endsWith(".wasm")) {
          wasm += size;
        } else {
          glue += size;
        }
      }
    }
  };
  walk(dir);
  return {
    name: "oxigraph",
    bytes: wasm + glue,
    children: [
      { name: "WASM runtime", bytes: wasm },
      { name: "JS glue + types", bytes: glue },
    ],
  };
}

scanInstalled();
const wazoo = wazooArtifact();
const artifact = artifactFiles();
const result = {
  generatedAt: new Date().toISOString(),
  engines: [wazoo, oxigraphArtifact(), comunicaArtifact()],
  wazoo: {
    artifactBytes: wazoo.bytes,
    gzipBytes: await gzipBytesOf(artifact),
    files: artifact.length,
  },
};
console.log(JSON.stringify(result, null, 2));

// Library-size measurement for the README's size comparison. Measures what a
// consumer must have on disk for each engine:
//
//   - native:  the JSR publish artifact (src/ + README.md + LICENSE), broken
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
/* native + oxigraph                                                  */
/* ------------------------------------------------------------------ */

function nativeArtifact(): Sized {
  const src = join(Deno.cwd(), "src");
  const subtractTests = (dir: string): number => {
    let sum = 0;
    for (const entry of Deno.readDirSync(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        sum += subtractTests(path);
      } else if (entry.name.endsWith(".test.ts")) {
        sum += Deno.statSync(path).size;
      }
    }
    return sum;
  };
  const children: Sized[] = [];
  let total = 0;
  for (const entry of Deno.readDirSync(src)) {
    if (!entry.isDirectory) {
      continue;
    }
    const net = dirBytes(join(src, entry.name)) -
      subtractTests(join(src, entry.name));
    children.push({ name: entry.name, bytes: net });
    total += net;
  }
  const readmeBytes = Deno.statSync(join(Deno.cwd(), "README.md")).size;
  const licenseBytes = Deno.statSync(join(Deno.cwd(), "LICENSE")).size;
  children.push({ name: "README.md", bytes: readmeBytes });
  children.push({ name: "LICENSE", bytes: licenseBytes });
  total += readmeBytes + licenseBytes;
  return { name: "native", bytes: total, children };
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
const result = {
  generatedAt: new Date().toISOString(),
  engines: [nativeArtifact(), oxigraphArtifact(), comunicaArtifact()],
};
console.log(JSON.stringify(result, null, 2));

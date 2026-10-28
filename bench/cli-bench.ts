// cli-bench measures `sparql` CLI builds end to end as processes: binary
// size, cold start, load, and a join-heavy query, plus peak RSS where
// `/usr/bin/time` exists (Linux). It is the baseline any other native build
// (e.g. scriptc, issue #221) must beat; every target must honor the
// cli/run-cli.ts contract, and the harness fails if targets disagree on
// output, so a faster but wrong build never "wins".
//
//   deno task bench:cli                      # deno-compile vs deno-run
//   deno task bench:cli --target scriptc=./sparql-native
//   deno task bench:cli --people 20000 --runs 10 --json
//
// Numbers are machine-specific: report them in PRs/issues with the machine,
// never commit them (README.md owns committed numbers).
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const IS_WINDOWS = Deno.build.os === "windows";
const COMPILED_PATH = join(
  REPO_ROOT,
  "dist",
  IS_WINDOWS ? "sparql.exe" : "sparql",
);

interface Target {
  name: string;
  command: string[];
  binaryPath?: string;
}

interface Workload {
  name: string;
  args: (dataPath: string) => string[];
}

interface Measurement {
  target: string;
  workload: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  peakRssMiB?: number;
}

function parseOptions(args: string[]) {
  const options = {
    targets: [] as Target[],
    people: 10_000,
    runs: 7,
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--people") {
      options.people = Number(args[++index]);
    } else if (flag === "--runs") {
      options.runs = Number(args[++index]);
    } else if (flag === "--target") {
      const spec = args[++index];
      const separator = spec.indexOf("=");
      if (separator < 1) {
        throw new Error(`--target needs name=command: ${spec}`);
      }
      const command = spec.slice(separator + 1).split(/\s+/);
      options.targets.push({
        name: spec.slice(0, separator),
        command,
        binaryPath: command.length === 1 ? command[0] : undefined,
      });
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return options;
}

async function compileCli(): Promise<void> {
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "--allow-read",
      "--output",
      COMPILED_PATH,
      "cli/main.ts",
    ],
    cwd: REPO_ROOT,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(
      `deno compile failed:\n${new TextDecoder().decode(stderr)}`,
    );
  }
}

/**
 * buildPeopleTurtle builds a people graph shaped like bench/memory-probe.ts: each
 * person has a name, an age, a city, and knows the next person and someone a
 * stride away, so friend-of-friend joins fan out (5 triples per person).
 */
function buildPeopleTurtle(count: number): string {
  const lines = ["@prefix : <http://example.org/> ."];
  for (let index = 0; index < count; index++) {
    lines.push(
      `:p${index} :name "Person ${index}" ; :age ${20 + (index % 50)} ; ` +
        `:city :c${index % 5} ; :knows :p${(index + 1) % count}, ` +
        `:p${(index + 7) % count} .`,
    );
  }
  return lines.join("\n") + "\n";
}

const WORKLOADS: Workload[] = [
  // Cold start: no data, the cheapest possible query.
  { name: "startup", args: () => ["--query", "ASK {}"] },
  // Parse and index the whole dataset, then a query that touches nothing,
  // so this isolates load cost. (A scan-shaped ASK would also measure
  // evaluation: ASK { ?s ?p ?o } currently does not stop at the first
  // solution.)
  {
    name: "load",
    args: (dataPath) => ["--data", dataPath, "--query", "ASK {}"],
  },
  // Join-heavy: friends of friends who share a city, aggregated.
  {
    name: "join",
    args: (dataPath) => [
      "--data",
      dataPath,
      "--query",
      "PREFIX : <http://example.org/> " +
      "SELECT ?city (COUNT(*) AS ?pairs) WHERE { " +
      "?a :knows ?b . ?b :knows ?c . ?a :city ?city . ?c :city ?city " +
      "} GROUP BY ?city ORDER BY ?city",
    ],
  },
];

async function hasGnuTime(): Promise<boolean> {
  if (IS_WINDOWS) return false;
  try {
    const { code } = await new Deno.Command("/usr/bin/time", {
      args: ["-f", "%M", "true"],
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch {
    return false;
  }
}

async function runOnce(
  command: string[],
  args: string[],
  measureRss: boolean,
): Promise<{ ms: number; stdout: string; peakRssKiB?: number }> {
  const [program, ...rest] = measureRss
    ? ["/usr/bin/time", "-f", "%M", ...command, ...args]
    : [...command, ...args];
  const started = performance.now();
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args: rest,
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const ms = performance.now() - started;
  const errorText = new TextDecoder().decode(stderr);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} exited ${code}:\n${errorText}`);
  }
  const peakRssKiB = measureRss
    ? Number(errorText.trim().split("\n").at(-1))
    : undefined;
  return { ms, stdout: new TextDecoder().decode(stdout), peakRssKiB };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const options = parseOptions(Deno.args);
if (options.targets.length === 0) {
  await compileCli();
  options.targets.push(
    {
      name: "deno-compile",
      command: [COMPILED_PATH],
      binaryPath: COMPILED_PATH,
    },
    {
      name: "deno-run",
      command: [Deno.execPath(), "run", "--allow-read", "cli/main.ts"],
    },
  );
}

const dataDir = await Deno.makeTempDir({ prefix: "sparql-cli-bench-" });
const dataPath = join(dataDir, "people.ttl");
await Deno.writeTextFile(dataPath, buildPeopleTurtle(options.people));
const measureRss = await hasGnuTime();

const measurements: Measurement[] = [];
const sizes: Record<string, number | undefined> = {};
try {
  for (const target of options.targets) {
    sizes[target.name] = target.binaryPath
      ? (await Deno.stat(resolve(REPO_ROOT, target.binaryPath))).size
      : undefined;
  }
  for (const workload of WORKLOADS) {
    const args = workload.args(dataPath);
    let referenceOutput: string | undefined;
    for (const target of options.targets) {
      // One untimed warm run fills the OS file cache, so every target is
      // measured warm-cache and cold-process.
      const warm = await runOnce(target.command, args, false);
      referenceOutput ??= warm.stdout;
      if (warm.stdout !== referenceOutput) {
        throw new Error(
          `${target.name} disagrees with ${
            options.targets[0].name
          } on ${workload.name}`,
        );
      }
      const times: number[] = [];
      let peakRssKiB = 0;
      for (let run = 0; run < options.runs; run++) {
        const result = await runOnce(target.command, args, measureRss);
        times.push(result.ms);
        peakRssKiB = Math.max(peakRssKiB, result.peakRssKiB ?? 0);
      }
      measurements.push({
        target: target.name,
        workload: workload.name,
        medianMs: median(times),
        minMs: Math.min(...times),
        maxMs: Math.max(...times),
        peakRssMiB: measureRss ? peakRssKiB / 1024 : undefined,
      });
    }
  }
} finally {
  await Deno.remove(dataDir, { recursive: true });
}

const environment = {
  os: `${Deno.build.os}-${Deno.build.arch}`,
  deno: Deno.version.deno,
  people: options.people,
  triples: options.people * 5,
  runs: options.runs,
};

if (options.json) {
  console.log(JSON.stringify({ environment, sizes, measurements }, null, 2));
} else {
  console.log(
    `sparql CLI bench — ${environment.os}, Deno ${environment.deno}, ` +
      `${environment.triples} triples, median of ${environment.runs} runs`,
  );
  console.log("\n| Target | Binary size |\n| --- | --- |");
  for (const target of options.targets) {
    const size = sizes[target.name];
    console.log(
      `| ${target.name} | ${
        size === undefined
          ? "n/a (needs a runtime)"
          : `${(size / 1024 / 1024).toFixed(1)} MiB`
      } |`,
    );
  }
  console.log(
    "\n| Workload | Target | Median ms | Min ms | Max ms | Peak RSS |",
  );
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const measurement of measurements) {
    console.log(
      `| ${measurement.workload} | ${measurement.target} | ` +
        `${measurement.medianMs.toFixed(1)} | ${
          measurement.minMs.toFixed(1)
        } | ` +
        `${measurement.maxMs.toFixed(1)} | ${
          measurement.peakRssMiB === undefined
            ? "n/a"
            : `${measurement.peakRssMiB.toFixed(1)} MiB`
        } |`,
    );
  }
}

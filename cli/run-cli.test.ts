import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "./run-cli.ts";
import type { CliHost, CliResult } from "./run-cli.ts";
import process from "node:process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../test/run-process.ts";

const files: Record<string, string> = {
  "people.ttl": `
    @prefix : <http://example.org/> .
    :alice :knows :bob .
    :bob :knows :carol .
  `,
  "select.rq":
    "SELECT ?who WHERE { <http://example.org/alice> <http://example.org/knows> ?who }",
};

const host: CliHost = {
  readTextFile: (path) =>
    path in files
      ? Promise.resolve(files[path])
      : Promise.reject(new Error(`no such file: ${path}`)),
};

test("runCli - SELECT prints SPARQL results JSON", async () => {
  const result = await runCli(
    ["--data", "people.ttl", "--query-file", "select.rq"],
    host,
  );
  assert.deepStrictEqual(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepStrictEqual(parsed.head.vars, ["who"]);
  assert.deepStrictEqual(
    parsed.results.bindings[0].who.value,
    "http://example.org/bob",
  );
});

test("runCli - ASK prints a boolean result", async () => {
  const result = await runCli(
    ["--data", "people.ttl", "--query", "ASK { ?s ?p ?o }"],
    host,
  );
  assert.deepStrictEqual(result.exitCode, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout).boolean, true);
});

test("runCli - CONSTRUCT prints N-Quads", async () => {
  const result = await runCli(
    [
      "--data",
      "people.ttl",
      "--query",
      "CONSTRUCT { ?b ?p ?a } WHERE { ?a ?p ?b }",
    ],
    host,
  );
  assert.deepStrictEqual(result.exitCode, 0);
  assert.ok(
    result.stdout.includes(
      "<http://example.org/bob> <http://example.org/knows> <http://example.org/alice> .",
    ),
    result.stdout,
  );
});

test("runCli - usage errors exit 2", async () => {
  assert.deepStrictEqual((await runCli([], host)).exitCode, 2);
  assert.deepStrictEqual((await runCli(["--query"], host)).exitCode, 2);
  assert.deepStrictEqual((await runCli(["--bogus", "x"], host)).exitCode, 2);
  assert.deepStrictEqual((await runCli(["--help"], host)).exitCode, 0);
});

test("runCli - query and load failures exit 1", async () => {
  const syntax = await runCli(["--query", "SELEKT"], host);
  assert.deepStrictEqual(syntax.exitCode, 1);
  const missing = await runCli(
    ["--data", "missing.ttl", "--query", "ASK {}"],
    host,
  );
  assert.deepStrictEqual(missing.exitCode, 1);
  assert.match(missing.stderr, /missing.ttl/);
});

/**
 * CliTarget is one built host entrypoint, checked against the in-process core.
 * The artifacts are optional: `deno task compile` writes dist/sparql and
 * `deno task native:build` writes dist/sparql-node, each with a .exe suffix on
 * Windows. A missing artifact skips its target, so `deno task ci` stays green
 * on a machine that has not built the hosts.
 */
interface CliTarget {
  /** name labels the target in test names and failure messages. */
  name: string;

  /** path is the absolute path of the built executable. */
  path: string;
}

/**
 * CliCase is one invocation every host must reproduce. stderrIncludes narrows
 * the stderr comparison for failures whose text the host's own file API spells:
 * the Deno and Node readers word a missing file differently, so only the exit
 * code, stdout, and the identifying fragment are compared.
 */
interface CliCase {
  /** name labels the case in failure messages. */
  name: string;

  /** args is the argv handed to every host, with absolute fixture paths. */
  args: string[];

  /** stderrIncludes turns the stderr assertion into a fragment check. */
  stderrIncludes?: string;
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE_SUFFIX = process.platform === "win32" ? ".exe" : "";

const CLI_TARGETS: CliTarget[] = [
  {
    name: "deno-compile",
    path: join(REPOSITORY_ROOT, `dist/sparql${EXECUTABLE_SUFFIX}`),
  },
  {
    name: "scriptc",
    path: join(REPOSITORY_ROOT, `dist/sparql-node${EXECUTABLE_SUFFIX}`),
  },
];

const ALICE_KNOWS = "<http://example.org/alice> <http://example.org/knows>";

/**
 * cliCases builds the shared argument table. Fixture paths are absolute so the
 * in-process core and every built host receive identical argv.
 */
function cliCases(directory: string): CliCase[] {
  const people = join(directory, "people.ttl");
  const select = (text: string): string[] => [
    "--data",
    people,
    "--query",
    text,
  ];
  return [
    {
      name: "SELECT prints results JSON",
      args: select(`SELECT ?who WHERE { ${ALICE_KNOWS} ?who }`),
    },
    {
      name: "SELECT reads --query-file",
      args: ["--data", people, "--query-file", join(directory, "select.rq")],
    },
    { name: "ASK prints a boolean", args: select("ASK { ?s ?p ?o }") },
    {
      name: "CONSTRUCT prints N-Quads",
      args: select("CONSTRUCT { ?b ?p ?a } WHERE { ?a ?p ?b }"),
    },
    {
      name: "property path with an unbound endpoint",
      args: select(`SELECT ?who WHERE { ${ALICE_KNOWS}+ ?who }`),
    },
    {
      name: "property path with no matching pairs",
      args: select(
        "SELECT ?who WHERE { <http://example.org/alice>" +
          " <http://example.org/nope>+ ?who }",
      ),
    },
    { name: "--help prints usage", args: ["--help"] },
    { name: "no arguments is a usage error", args: [] },
    { name: "--query without a value is a usage error", args: ["--query"] },
    { name: "unknown flag is a usage error", args: ["--bogus", "x"] },
    { name: "query syntax error exits 1", args: select("SELEKT") },
    {
      name: "missing data file exits 1",
      args: ["--data", join(directory, "missing.ttl"), "--query", "ASK {}"],
      stderrIncludes: "missing.ttl",
    },
  ];
}

/** runTarget executes one built host and returns its process-level result. */
async function runTarget(
  target: CliTarget,
  args: string[],
): Promise<CliResult> {
  const { code, stdout, stderr } = await runProcess(target.path, args);
  return { exitCode: code, stdout, stderr };
}

/** cliTargetExists reports whether a built host is on disk. */
function cliTargetExists(target: CliTarget): boolean {
  try {
    statSync(target.path);
    return true;
  } catch {
    return false;
  }
}

const IN_PROCESS_HOST: CliHost = {
  readTextFile: (path) => readFile(path, "utf8"),
};

for (const target of CLI_TARGETS) {
  test(
    `runCli cross-target - ${target.name} host matches the in-process core`,
    { skip: !cliTargetExists(target) },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "sparql-cli-"));
      try {
        await writeFile(join(directory, "people.ttl"), files["people.ttl"]);
        await writeFile(join(directory, "select.rq"), files["select.rq"]);
        for (const testCase of cliCases(directory)) {
          const expected = await runCli(testCase.args, IN_PROCESS_HOST);
          const actual = await runTarget(target, testCase.args);
          const label = `${target.name} - ${testCase.name}`;
          assert.deepStrictEqual(
            actual.exitCode,
            expected.exitCode,
            `${label}: exit code`,
          );
          assert.deepStrictEqual(
            actual.stdout,
            expected.stdout,
            `${label}: stdout`,
          );
          if (testCase.stderrIncludes === undefined) {
            assert.deepStrictEqual(
              actual.stderr,
              expected.stderr,
              `${label}: stderr`,
            );
          } else {
            assert.ok(
              actual.stderr.includes(testCase.stderrIncludes),
              `${label}: stderr includes ${testCase.stderrIncludes}: ${actual.stderr}`,
            );
          }
        }
      } finally {
        await rm(directory, { recursive: true });
      }
    },
  );
}

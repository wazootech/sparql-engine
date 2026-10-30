import { assertEquals, assertStringIncludes } from "@std/assert";
import { runCli } from "./run-cli.ts";
import type { CliHost } from "./run-cli.ts";

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

Deno.test("runCli - SELECT prints SPARQL results JSON", async () => {
  const result = await runCli(
    ["--data", "people.ttl", "--query-file", "select.rq"],
    host,
  );
  assertEquals(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assertEquals(parsed.head.vars, ["who"]);
  assertEquals(parsed.results.bindings[0].who.value, "http://example.org/bob");
});

Deno.test("runCli - ASK prints a boolean result", async () => {
  const result = await runCli(
    ["--data", "people.ttl", "--query", "ASK { ?s ?p ?o }"],
    host,
  );
  assertEquals(result.exitCode, 0);
  assertEquals(JSON.parse(result.stdout).boolean, true);
});

Deno.test("runCli - CONSTRUCT prints N-Quads", async () => {
  const result = await runCli(
    [
      "--data",
      "people.ttl",
      "--query",
      "CONSTRUCT { ?b ?p ?a } WHERE { ?a ?p ?b }",
    ],
    host,
  );
  assertEquals(result.exitCode, 0);
  assertStringIncludes(
    result.stdout,
    "<http://example.org/bob> <http://example.org/knows> <http://example.org/alice> .",
  );
});

Deno.test("runCli - usage errors exit 2", async () => {
  assertEquals((await runCli([], host)).exitCode, 2);
  assertEquals((await runCli(["--query"], host)).exitCode, 2);
  assertEquals((await runCli(["--bogus", "x"], host)).exitCode, 2);
  assertEquals((await runCli(["--help"], host)).exitCode, 0);
});

Deno.test("runCli - query and load failures exit 1", async () => {
  const syntax = await runCli(["--query", "SELEKT"], host);
  assertEquals(syntax.exitCode, 1);
  const missing = await runCli(
    ["--data", "missing.ttl", "--query", "ASK {}"],
    host,
  );
  assertEquals(missing.exitCode, 1);
  assertStringIncludes(missing.stderr, "missing.ttl");
});

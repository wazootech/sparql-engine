// run-cli is the runtime-agnostic core of the `sparql` command: it parses
// arguments, loads RDF documents into a MemoryStore, runs one query, and
// returns the serialized output. Host entrypoints (cli/main.ts for
// `deno compile`, and any future native build such as scriptc) only supply
// file reading and process I/O, so every build answers the same contract and
// bench/cli-bench.ts can compare them like for like.
import { MemoryStore } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import { serializeJsonResults } from "@/serialize/json-results.ts";
import { serializeTurtle } from "@/serialize/turtle-writer.ts";

/**
 * CLI_USAGE is the help text printed for --help and argument errors.
 */
export const CLI_USAGE =
  `Usage: sparql [--data <file>]... (--query <text> | --query-file <file>)

Loads Turtle, TriG, N-Triples, or N-Quads files into an in-memory store and
runs one SPARQL query or update against them.

  --data <file>        RDF document to load (repeatable)
  --query <text>       SPARQL query or update text
  --query-file <file>  read the SPARQL text from a file
  --base <iri>         base IRI for the query (default: none)
  --help               print this help

SELECT and ASK print SPARQL 1.1 Query Results JSON; CONSTRUCT and DESCRIBE
print N-Quads; updates print nothing.`;

/**
 * CliHost is the host-runtime surface run-cli needs: reading a text file.
 */
export interface CliHost {
  /** readTextFile reads a UTF-8 file by path. */
  readTextFile(path: string): Promise<string>;
}

/**
 * CliResult is the outcome of one CLI invocation.
 */
export interface CliResult {
  /** exitCode is the process exit code: 0 success, 1 query failure, 2 usage. */
  exitCode: number;

  /** stdout is the text to write to standard output. */
  stdout: string;

  /** stderr is the text to write to standard error. */
  stderr: string;
}

interface CliArguments {
  dataPaths: string[];
  query?: string;
  queryPath?: string;
  baseIri?: string;
  help: boolean;
}

function parseArguments(args: string[]): CliArguments {
  const parsed: CliArguments = { dataPaths: [], help: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    index++;
    switch (flag) {
      case "--data":
        parsed.dataPaths.push(value);
        break;
      case "--query":
        parsed.query = value;
        break;
      case "--query-file":
        parsed.queryPath = value;
        break;
      case "--base":
        parsed.baseIri = value;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }
  return parsed;
}

/**
 * runCli executes one `sparql` invocation against the given host.
 */
export async function runCli(
  args: string[],
  host: CliHost,
): Promise<CliResult> {
  let parsed: CliArguments;
  try {
    parsed = parseArguments(args);
  } catch (error) {
    return usageError((error as Error).message);
  }
  if (parsed.help) {
    return { exitCode: 0, stdout: CLI_USAGE + "\n", stderr: "" };
  }
  if ((parsed.query === undefined) === (parsed.queryPath === undefined)) {
    return usageError("pass exactly one of --query or --query-file");
  }

  try {
    const store = new MemoryStore();
    for (const path of parsed.dataPaths) {
      const text = await host.readTextFile(path);
      for (const quad of parseTurtleQuads(text, parsed.baseIri)) {
        store.addQuad(quad);
      }
    }
    const query = parsed.query ??
      await host.readTextFile(parsed.queryPath as string);

    const engine = new WazooSparqlEngine({ store });
    const response = await engine.execute({
      query,
      baseIri: parsed.baseIri,
    });

    switch (response.kind) {
      case "select":
      case "ask":
        return {
          exitCode: 0,
          stdout: serializeJsonResults(response) + "\n",
          stderr: "",
        };
      case "construct":
        return {
          exitCode: 0,
          stdout: serializeTurtle(response.data.quads, { format: "n-quads" }),
          stderr: "",
        };
      case "void":
        return { exitCode: 0, stdout: "", stderr: "" };
    }
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `sparql: ${(error as Error).message}\n`,
    };
  }
}

function usageError(message: string): CliResult {
  return {
    exitCode: 2,
    stdout: "",
    stderr: `sparql: ${message}\n\n${CLI_USAGE}\n`,
  };
}

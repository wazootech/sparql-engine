/**
 * cli-args holds the `sparql` CLI's argument grammar: flag parsing shared by
 * the Deno and native hosts, kept host-agnostic so both hold the built CLI to
 * the same contract.
 */

export interface CliArguments {
  dataPaths: string[];
  query?: string;
  queryPath?: string;
  baseIri?: string;
  help: boolean;
}


type ParseResult =
  | { ok: true; cliArguments: CliArguments }
  | { ok: false; message: string };

/** parseArguments turns one argument list into flags or a usage message. */
export function parseArguments(args: string[]): ParseResult {
  const parsed: CliArguments = { dataPaths: [], help: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) {
      return { ok: false, message: `missing value for ${flag}` };
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
        return { ok: false, message: `unknown argument: ${flag}` };
    }
  }
  return { ok: true, cliArguments: parsed };
}

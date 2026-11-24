/**
 * cli-bench-build compiles each bench target and reads the run's flags: the
 * compile step every target shares and the options parser.
 */
import type { Options } from "./cli-bench-types.ts";
import { COMPILED_PATH, IS_WINDOWS, REPO_ROOT } from "./cli-bench-env.ts";
import {
  compileCommand,
  runProcess,
  runtimeName,
} from "../test/run-process.ts";

export function parseOptions(args: string[]): Options {
  const options: Options = {
    targets: [],
    people: [10_000],
    runs: 11,
    json: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json") {
      options.json = true;
    } else if (flag === "--people") {
      const spec = args[++index];
      const sizes = spec.split(",").map(Number);
      if (sizes.some((size) => !Number.isInteger(size) || size < 1)) {
        throw new Error(`--people needs positive integers: ${spec}`);
      }
      options.people = sizes;
    } else if (flag === "--runs") {
      const spec = args[++index];
      options.runs = Number(spec);
      if (!Number.isInteger(options.runs) || options.runs < 1) {
        throw new Error(`--runs needs a positive integer: ${spec}`);
      }
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

export async function compileCli(): Promise<void> {
  const [program, ...args] = compileCommand("cli/main.ts", COMPILED_PATH);
  const { code, stderr } = await runProcess(program, args, { cwd: REPO_ROOT });
  if (code !== 0) {
    throw new Error(`${runtimeName} compile failed:
${stderr}`);
  }
}

export async function hasGnuTime(): Promise<boolean> {
  if (IS_WINDOWS) return false;
  try {
    const { code } = await runProcess("/usr/bin/time", ["-f", "%M", "true"]);
    return code === 0;
  } catch {
    return false;
  }
}

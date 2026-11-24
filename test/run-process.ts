/**
 * run-process runs child processes for the repository's scripts, tests and
 * benches on Bun. `process.execPath` is the running Bun binary, so a script
 * re-invokes itself, and the helpers below build the command lines for "run
 * this script / test file / compile this entry".
 */
import { spawn } from "node:child_process";
import process from "node:process";

/** ProcessResult is the exit code plus captured stdout and stderr. */
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** ProcessOptions are the spawn settings the repository scripts use. */
export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** inherit streams the child's stdout and stderr to this process's. */
  inherit?: boolean;
}

/** runtimeName names the running runtime for report headers. */
export const runtimeName = "bun";

/**
 * runProcess spawns `program` and resolves once it exits. A non-zero exit is a
 * result, not an exception; only a program that cannot be started (for
 * example a missing binary) rejects.
 */
export function runProcess(
  program: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      // Windows runs .cmd shims (npx.cmd) only through a shell.
      shell: process.platform === "win32" && program.endsWith(".cmd"),
      stdio: options.inherit
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

/** scriptCommand returns the argv that runs a TypeScript file on this runtime. */
export function scriptCommand(script: string, args: string[] = []): string[] {
  return [process.execPath, script, ...args];
}

/** testCommand returns the argv that runs a test file on this runtime. */
export function testCommand(file: string): string[] {
  return [process.execPath, "test", file];
}

/** compileCommand returns the argv that compiles `entry` to a binary at `output`. */
export function compileCommand(entry: string, output: string): string[] {
  return [process.execPath, "build", "--compile", entry, "--outfile", output];
}

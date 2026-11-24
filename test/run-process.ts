/**
 * run-process runs child processes for the repository's scripts, tests and
 * benches on whichever runtime (Deno or Bun) is running them. `process.execPath`
 * is that runtime's binary, so the same script re-invokes itself, and the
 * helpers below translate "run this script / test file / compile this entry"
 * into the matching command line for each runtime.
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

/** isBun reports whether the current runtime is Bun. */
export const isBun: boolean = process.versions.bun !== undefined;

/** runtimeName names the running runtime for report headers. */
export const runtimeName: "bun" | "deno" = isBun ? "bun" : "deno";

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
  return isBun
    ? [process.execPath, script, ...args]
    : [process.execPath, "run", "--allow-all", script, ...args];
}

/** testCommand returns the argv that runs a test file on this runtime. */
export function testCommand(file: string): string[] {
  return isBun
    ? [process.execPath, "test", file]
    : [process.execPath, "test", "--allow-all", file];
}

/** compileCommand returns the argv that compiles `entry` to a binary at `output`. */
export function compileCommand(entry: string, output: string): string[] {
  return isBun
    ? [process.execPath, "build", "--compile", entry, "--outfile", output]
    : [process.execPath, "compile", "--allow-read", "--output", output, entry];
}

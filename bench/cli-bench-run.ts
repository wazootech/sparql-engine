/**
 * cli-bench-run runs one CLI invocation as a process and returns its parsed
 * stage timings (cold-start and query stage separation happens in
 * cli-bench-measure).
 */
import { REPO_ROOT } from "./cli-bench-env.ts";

export async function runOnce(
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

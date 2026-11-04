/**
 * cli-bench-ops declares the stages a CLI invocation is decomposed into and
 * the workloads each stage runs, shared by the runner and the measurer.
 */
import type { Operation } from "./cli-bench-types.ts";

/**
 * OPERATIONS are the stages a CLI invocation is decomposed into. Subtracting
 * inside one round keeps machine drift out of the difference, which is what
 * makes a stage measurement steadier than the totals it comes from.
 */
export const OPERATIONS: Operation[] = [
  { name: "cold start", workload: "startup" },
  { name: "read + parse + index", workload: "load", subtrahend: "startup" },
  { name: "query evaluation", workload: "join", subtrahend: "load" },
];

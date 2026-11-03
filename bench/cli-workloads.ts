// cli-workloads owns the CLI bench fixture and invocation table shared by
// bench/cli-bench.ts (size, cold start, load, join, peak RSS) and
// bench/cli-targets-bench.ts (Deno.bench comparison across builds), so both
// measure the same data with the same argv.

/**
 * Workload is one CLI invocation shape. args receives the fixture path; the
 * startup workload ignores it because it loads no data.
 */
export interface Workload {
  /** name labels the workload in bench output and recorded data. */
  name: string;

  /** args builds the argv for a target, given the fixture path. */
  args: (dataPath: string) => string[];
}

/**
 * buildPeopleTurtle builds a people graph shaped like bench/memory-probe.ts: each
 * person has a name, an age, a city, and knows the next person and someone a
 * stride away, so friend-of-friend joins fan out (5 triples per person).
 */
export function buildPeopleTurtle(count: number): string {
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

/**
 * WORKLOADS is the invocation table every CLI target is measured on. Each
 * workload isolates one cost: process start, parsing and indexing, or a
 * friend-of-friend join.
 */
export const WORKLOADS: Workload[] = [
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

import type * as rdfjs from "@rdfjs/types";
import { DISTINCT_SAMPLE_CAP } from "@/planner/pattern-stats-types.ts";
import type { PatternStats } from "@/planner/pattern-stats-types.ts";
import type { ScanEntry } from "@/evaluator/join.ts";
import { termKey } from "@/term/mod.ts";

/**
 * fallbackStats derives PatternStats from the pattern's own candidate scan —
 * the candidates array evaluateWithReordering already materializes — so the
 * fallback needs no extra store access. The distinct-value pass is bounded:
 * candidates up to DISTINCT_SAMPLE_CAP count exactly; larger scans sample an
 * evenly spaced stride of at most the cap and scale the distinct count by
 * the sampling ratio, keeping large-store overhead constant.
 */
export function fallbackStats(entry: ScanEntry): PatternStats {
  const quads = entry.candidates;
  // Track each variable position by its query variable name (the same
  // name the join binds and the estimator reads), so distinctByVar is keyed
  // like the hook's contract. Blank-node pattern positions act as query
  // variables named `_:label` (matching getQueryVarName in join.ts).
  const positions: { name: string; index: 0 | 1 | 2 }[] = [];
  for (
    const [term, index] of [
      [entry.subject, 0],
      [entry.predicate, 1],
      [entry.object, 2],
    ] as const
  ) {
    if (term.termType === "Variable" || term.termType === "BlankNode") {
      positions.push({
        name: term.termType === "BlankNode" ? `_:${term.value}` : term.value,
        index,
      });
    }
  }
  const distinctByVar: Partial<Record<string, number>> = {};
  const n = quads.length;
  if (n === 0) {
    return { candidates: 0, distinctByVar };
  }
  const quadTerm = (quad: rdfjs.Quad, index: 0 | 1 | 2): rdfjs.Term =>
    index === 0 ? quad.subject : index === 1 ? quad.predicate : quad.object;
  if (n <= DISTINCT_SAMPLE_CAP) {
    const sets = positions.map(() => new Set<string>());
    for (const quad of quads) {
      for (let index = 0; index < positions.length; index++) {
        sets[index].add(termKey(quadTerm(quad, positions[index].index)));
      }
    }
    for (let index = 0; index < positions.length; index++) {
      distinctByVar[positions[index].name] = sets[index].size;
    }
    return { candidates: n, distinctByVar };
  }
  // Bounded sample: stride = n / cap, so exactly ~cap candidates are
  // examined, evenly spaced (deterministic — no randomness).
  const stride = Math.ceil(n / DISTINCT_SAMPLE_CAP);
  const sets = positions.map(() => new Set<string>());
  let sampled = 0;
  for (let index = 0; index < n; index += stride) {
    const quad = quads[index];
    for (let p = 0; p < positions.length; p++) {
      sets[p].add(termKey(quadTerm(quad, positions[p].index)));
    }
    sampled++;
  }
  const scale = n / sampled;
  for (let index = 0; index < positions.length; index++) {
    distinctByVar[positions[index].name] = Math.min(
      n,
      Math.round(sets[index].size * scale),
    );
  }
  return { candidates: n, distinctByVar };
}

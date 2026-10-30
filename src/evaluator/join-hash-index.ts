import { bindingsCompatible, joinKey } from "@/evaluator/join-bindings.ts";
import type { TermBinding } from "@/evaluator/join-bindings.ts";
import { termKey } from "@/term/mod.ts";

/* ------------------------------------------------------------------ */
/* Hash join (issue #73)                                              */
/*                                                                    */
/* innerJoin / leftJoin / minus above dispatch large joins here. The  */
/* right side is indexed once by the shared variables; each left      */
/* binding probes only its compatible candidates instead of scanning  */
/* the whole right side, turning the O(n·m) nested loop into a probe  */
/* of O(n) buckets. Multiset semantics are preserved: every compatible */
/* pair still produces its merged binding, duplicates included.       */
/*                                                                    */
/* Prior art: the build-once-index-probe-per-tuple in-memory hash     */
/* join is the classic scheme of Shapiro (and GRACE):                 */
/*   @see {@link https://doi.org/10.1145/6314.6315 Shapiro, "Join Processing in Database Systems with Large Main Memories," ACM TODS 11(3), 1986, pp. 239–264} */
/*   @see Kitsuregawa, Tanaka & Yamamori, "Architecture and Performance of Relational Algebra Machine GRACE," ICPP, 1983, pp. 241–250 */
/* ------------------------------------------------------------------ */

/**
 * JOIN_PRODUCT_THRESHOLD is the pair count below which the nested loop is
 * kept: hash-setup (indexing the right side) costs more than the scan it
 * saves for tiny joins.
 *
 * Prior art: choosing a join method from an estimated cost (here the
 * product of the input sizes) is cost-based join-method selection.
 * @see {@link https://doi.org/10.1145/152610.152611 Graefe, "Query Evaluation Techniques for Large Databases," ACM Computing Surveys 25(2), 1993, pp. 73–170}
 * @see {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}
 */
export const JOIN_PRODUCT_THRESHOLD = 4096;

/**
 * STREAM_NESTED_THRESHOLD bounds the right side of a nested-loop join whose
 * left side streams as a generator (the lazy slice): the left length is
 * unknown without materializing, so the product threshold cannot apply, but
 * a right side this small keeps the nested loop cheap for any left length.
 * Larger right sides dispatch to the (inherently eager) hash index.
 * (Same cost-based method-selection prior art as JOIN_PRODUCT_THRESHOLD:
 * {@link https://doi.org/10.1145/152610.152611 Graefe, "Query Evaluation Techniques for Large Databases," ACM Computing Surveys 25(2), 1993, pp. 73–170};
 * {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}.)
 */
export const STREAM_NESTED_THRESHOLD = 64;

/**
 * HashIndex is the right side indexed for probing:
 * - exact buckets total bindings (those binding every shared variable) by
 *   their full key, so identical keys are compatible by construction;
 * - byVar buckets every binding by each shared variable it binds, for
 *   partial left bindings to probe their most selective variable;
 * - partials holds the right bindings missing at least one shared variable
 *   (OPTIONAL failures), which are wildcards and need per-probe checks.
 */
interface HashIndex {
  exact: Map<string, TermBinding[]>;
  byVar: Map<string, Map<string, TermBinding[]>>;
  partials: TermBinding[];
}

export function buildHashIndex(
  right: TermBinding[],
  joinVars: string[],
): HashIndex {
  const exact = new Map<string, TermBinding[]>();
  const byVar = new Map<string, Map<string, TermBinding[]>>();
  const partials: TermBinding[] = [];
  for (const binding of right) {
    let total = true;
    for (const v of joinVars) {
      if (binding[v] === undefined) {
        total = false;
        break;
      }
    }
    if (total) {
      const key = joinKey(binding, joinVars);
      const bucket = exact.get(key);
      if (bucket) {
        bucket.push(binding);
      } else {
        exact.set(key, [binding]);
      }
    } else {
      partials.push(binding);
    }
    for (const v of joinVars) {
      const t = binding[v];
      if (t === undefined) {
        continue;
      }
      let varMap = byVar.get(v);
      if (varMap === undefined) {
        varMap = new Map();
        byVar.set(v, varMap);
      }
      const tk = termKey(t);
      const bucket = varMap.get(tk);
      if (bucket) {
        bucket.push(binding);
      } else {
        varMap.set(tk, [binding]);
      }
    }
  }
  return { exact, byVar, partials };
}

/**
 * compatibleCandidates returns the right bindings compatible with l — those
 * agreeing with l on every variable both bind. A total l (binding every
 * shared variable) probes the exact bucket, which is compatible by
 * construction, plus the (usually few) partial rights it agrees with. A
 * partial l probes the bucket of its most selective bound variable and
 * verifies, plus partial rights that do not bind that variable.
 *
 * Prior art: probing the bucket with the fewest candidates (most selective
 * bound variable) is access-path selection on the join key.
 * @see {@link https://doi.org/10.1145/582095.582099 Selinger et al., "Access Path Selection in a Relational Database Management System," SIGMOD '79, pp. 23–34}
 */
export function compatibleCandidates(
  l: TermBinding,
  joinVars: string[],
  index: HashIndex,
  right: TermBinding[],
): TermBinding[] {
  let total = true;
  for (const v of joinVars) {
    if (l[v] === undefined) {
      total = false;
      break;
    }
  }
  if (total) {
    const exactHits = index.exact.get(joinKey(l, joinVars)) ?? [];
    if (index.partials.length === 0) {
      return exactHits;
    }
    const out = exactHits.slice();
    for (const r of index.partials) {
      if (bindingsCompatible(l, r)) {
        out.push(r);
      }
    }
    return out;
  }
  // Partial l: pick the shared variable it binds with the smallest right
  // bucket (most selective), probe it, and verify the rest of the agreement.
  let bestVar: string | null = null;
  let bestKey = "";
  let bestSize = Infinity;
  for (const v of joinVars) {
    const t = l[v];
    if (t === undefined) {
      continue;
    }
    const tk = termKey(t);
    const size = index.byVar.get(v)?.get(tk)?.length ?? 0;
    if (size < bestSize) {
      bestSize = size;
      bestVar = v;
      bestKey = tk;
    }
  }
  if (bestVar === null) {
    // l binds none of the shared variables: compatible with every right
    // binding (they cannot disagree on any shared position).
    return right;
  }
  const out: TermBinding[] = [];
  for (const r of index.byVar.get(bestVar)?.get(bestKey) ?? []) {
    if (bindingsCompatible(l, r)) {
      out.push(r);
    }
  }
  for (const r of index.partials) {
    if (r[bestVar] === undefined && bindingsCompatible(l, r)) {
      out.push(r);
    }
  }
  return out;
}

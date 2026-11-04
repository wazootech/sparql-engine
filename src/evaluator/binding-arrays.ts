import type { TermBinding } from "@/evaluator/join-bindings.ts";

/** copyBindingsArray is an identity helper for array-only binding flows. */
export function copyBindingsArray(bindings: TermBinding[]): TermBinding[] {
  return bindings;
}
 /** filterBindingsArray materializes filterBindings for array inputs (scriptc-safe). */
export function filterBindingsArray(
  bindings: TermBinding[],
  predicate: (binding: TermBinding) => boolean,
): TermBinding[] {
  const out: TermBinding[] = [];
  for (let index = 0; index < bindings.length; index++) {
    const binding = bindings[index];
    if (predicate(binding)) {
      out.push(binding);
    }
  }
  return out;
}
 /** mapBindingsArray materializes mapBindings for array inputs (scriptc-safe). */
export function mapBindingsArray(
  bindings: TermBinding[],
  transform: (binding: TermBinding) => TermBinding,
): TermBinding[] {
  const out: TermBinding[] = [];
  for (let index = 0; index < bindings.length; index++) {
    out.push(transform(bindings[index]));
  }
  return out;
}

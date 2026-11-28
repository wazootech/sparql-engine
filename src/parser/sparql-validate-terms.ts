/**
 * sparql-validate-terms.ts holds the per-node checks of the validation pass: a
 * blank node label belongs to one basic graph pattern, and SUBSTR, REGEX and
 * REPLACE take a bounded number of arguments.
 */

import type { OperationExpression, Term, Triple } from "@/parser/ast.ts";

/** BlankNodeBlocks maps each written label to its basic graph pattern. */
export interface BlankNodeBlocks {
  count: number;
  owners: Map<string, number>;
}

/** checkArity bounds the builtins the grammar reads as argument lists. */
export function checkArity(operation: OperationExpression): undefined {
  const name = operation.operator;
  if (name !== "substr" && name !== "regex" && name !== "replace") {
    return;
  }
  const least = name === "replace" ? 3 : 2;
  const given = operation.args.length;
  if (given < least || given > least + 1) {
    throw new Error(
      `${name.toUpperCase()} takes ${least} or ${least + 1} arguments`,
    );
  }
}

/** claimBlankNodes records which block each written label belongs to. */
export function claimBlankNodes(
  triples: Triple[],
  block: number,
  blocks: BlankNodeBlocks,
): undefined {
  for (const triple of triples) {
    claimTerm(triple.subject, block, blocks);
    claimTerm(triple.object, block, blocks);
  }
}

function claimTerm(
  term: Term,
  block: number,
  blocks: BlankNodeBlocks,
): undefined {
  if (term.termType === "Quad") {
    claimTerm(term.subject as Term, block, blocks);
    claimTerm(term.object as Term, block, blocks);
    return;
  }
  // "e_" marks a label the query wrote; generated ones cannot collide.
  if (term.termType !== "BlankNode" || !term.value.startsWith("e_")) {
    return;
  }
  const owner = blocks.owners.get(term.value);
  if (owner !== undefined && owner !== block) {
    throw new Error(
      "Detected reuse of blank node across two different basic graph patterns (_:" +
        term.value.slice(2) +
        ")",
    );
  }
  blocks.owners.set(term.value, block);
}

import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";

const { namedNode, quad } = DataFactory;
const node = (id: string) => namedNode(`urn:${id}`);

/** edges makes b-e reachable forward and, through e-q-b, backward as well. */
const edges = [
  ["a", "p", "b"],
  ["a", "q", "b"],
  ["b", "r", "e"],
  ["e", "q", "b"],
].map(([s, p, o]) => quad(node(s!), node(p!), node(o!)));

function paths(name: string, pattern: string): ParityTestCase {
  return {
    name: `negated property sets - ${name}`,
    kind: "select",
    query: `SELECT * WHERE { ${pattern} }`,
    quads: edges,
  };
}

const BOTH = "!(^<urn:r>|<urn:q>)";

export const negatedSetCases: ParityTestCase[] = [
  paths("both directions keep both routes", `?x ${BOTH} ?z`),
  paths("from a subject", `<urn:b> ${BOTH} ?z`),
  paths("to an object", `?x ${BOTH} <urn:e>`),
  paths("inside an alternation", `?x ${BOTH}|<urn:r> ?z`),
  paths("inside a sequence", `?x ${BOTH}/<urn:r> ?z`),
  paths("forward only joins parallel edges", "?x !<urn:r> ?z"),
  paths("inverse only", "?x !^<urn:r> ?z"),
  paths("inside EXISTS", `?x ?p ?z FILTER EXISTS { ?x ${BOTH} ?z }`),
];

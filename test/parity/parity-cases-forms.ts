import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase } from "./parity-harness.ts";

const { literal, namedNode, quad } = DataFactory;
const node = (id: string) => namedNode(`urn:${id}`);

/** people gives three subjects an age, a name and a link to the next. */
const people = ["a", "b", "c"].flatMap((id, index) => [
  quad(node(id), node("age"), literal(String(30 - index))),
  quad(node(id), node("name"), literal(`name-${id}`)),
  quad(node(id), node("next"), node("abc"[(index + 1) % 3]!)),
]);

function construct(name: string, query: string): ParityTestCase {
  return {
    name: `query forms - ${name}`,
    kind: "construct",
    query,
    quads: people,
  };
}

function ask(name: string, query: string): ParityTestCase {
  return { name: `query forms - ${name}`, kind: "ask", query, quads: people };
}

const BY_AGE = "WHERE { ?s <urn:age> ?age } ORDER BY ?age";

export const formCases: ParityTestCase[] = [
  construct(
    "CONSTRUCT with ORDER BY and LIMIT",
    `CONSTRUCT { ?s <urn:first> ?age } ${BY_AGE} LIMIT 1`,
  ),
  construct(
    "CONSTRUCT with ORDER BY DESC, OFFSET and LIMIT",
    "CONSTRUCT { ?s <urn:second> ?age } WHERE { ?s <urn:age> ?age } " +
      "ORDER BY DESC(?age) OFFSET 1 LIMIT 1",
  ),
  construct(
    "CONSTRUCT with a trailing VALUES clause",
    "CONSTRUCT { ?s <urn:picked> ?age } WHERE { ?s <urn:age> ?age } " +
      "VALUES ?s { <urn:b> }",
  ),
  construct(
    "CONSTRUCT WHERE with LIMIT zero",
    "CONSTRUCT WHERE { ?s <urn:age> ?age } LIMIT 0",
  ),
  ask(
    "ASK with a trailing VALUES clause that matches nothing",
    "ASK { ?s <urn:age> ?age } VALUES ?s { <urn:zz> }",
  ),
  ask(
    "ASK with a trailing VALUES clause that matches",
    "ASK { ?s <urn:age> ?age } VALUES ?s { <urn:a> }",
  ),
];

import { DataFactory } from "@/term/mod.ts";
import type { ParityTestCase, ParityQueryKind } from "./parity-harness.ts";

const { namedNode, quad } = DataFactory;
const edge = [quad(namedNode("urn:a"), namedNode("urn:p"), namedNode("urn:b"))];

function over(
  name: string,
  kind: ParityQueryKind,
  query: string,
): ParityTestCase {
  return { name: `empty VALUES - ${name}`, kind, query, quads: edge };
}

export const emptyValuesCases: ParityTestCase[] = [
  over("ASK", "ask", "ASK { ?s ?p ?o } VALUES ?s { }"),
  over("SELECT", "select", "SELECT * WHERE { ?s ?p ?o } VALUES ?s { }"),
  over(
    "no variables and no rows",
    "select",
    "SELECT * WHERE { ?s ?p ?o } VALUES () { }",
  ),
  over(
    "no variables and one row keeps the solutions",
    "select",
    "SELECT * WHERE { ?s ?p ?o } VALUES () { () }",
  ),
  over(
    "inside a subquery",
    "select",
    "SELECT * WHERE { ?s ?p ?o { SELECT ?s WHERE { ?s ?p ?o } VALUES ?s { } } }",
  ),
  over(
    "CONSTRUCT",
    "construct",
    "CONSTRUCT { ?s <urn:x> ?o } WHERE { ?s ?p ?o } VALUES ?s { }",
  ),
];

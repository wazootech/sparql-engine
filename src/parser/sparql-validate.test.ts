import { test } from "node:test";
import assert from "node:assert/strict";
import { SparqlParser } from "@/parser/sparql-parser.ts";
import { Parser } from "@/parser/mod.ts";

const parse = (query: string) =>
  new SparqlParser().parse(`PREFIX : <urn:> ${query}`);

const rejected: Record<string, [string, RegExp]> = {
  "a plain variable beside COUNT(*)": [
    "SELECT ?o (COUNT(*) AS ?n) WHERE { ?s ?p ?o }",
    /ungrouped variable/,
  ],
  "a plain variable beside SUM": [
    "SELECT ?o (SUM(1) AS ?n) WHERE { ?s ?p ?o }",
    /ungrouped variable/,
  ],
  "a variable outside the aggregate": [
    "SELECT (?o + COUNT(?s) AS ?n) WHERE { ?s ?p ?o }",
    /ungrouped variable/,
  ],
  "a variable made ungrouped by ORDER BY": [
    "SELECT ?s WHERE { ?s ?p ?o } ORDER BY COUNT(?o)",
    /ungrouped variable/,
  ],
  "a variable made ungrouped by HAVING": [
    "SELECT ?s WHERE { ?s ?p ?o } HAVING (COUNT(?o) > 0)",
    /ungrouped variable/,
  ],
  "an alias over a pattern variable": [
    "SELECT (1 AS ?s) WHERE { ?s ?p ?o }",
    /already in scope/,
  ],
  "an alias over a VALUES variable": [
    "SELECT (1 AS ?x) WHERE {} VALUES ?x { 2 }",
    /already in scope/,
  ],
  "an alias over a subquery column": [
    "SELECT (1 AS ?s) WHERE { { SELECT ?s WHERE { ?s ?p ?o } } }",
    /already in scope/,
  ],
  "an alias used by an earlier expression": [
    "SELECT (?n + 1 AS ?m) (COUNT(*) AS ?n) WHERE {}",
    /ungrouped variable|already in scope/,
  ],
  "BIND after OPTIONAL bound it": [
    "SELECT * WHERE { ?s ?p ?o OPTIONAL { ?s ?q ?z } BIND(1 AS ?z) }",
    /already bound/,
  ],
  "BIND after VALUES bound it": [
    "SELECT * WHERE { VALUES ?x { 1 } BIND(2 AS ?x) }",
    /already bound/,
  ],
  "BIND after a subquery projected it": [
    "SELECT * WHERE { { SELECT * WHERE { ?s ?p ?o } } BIND(1 AS ?s) }",
    /already bound/,
  ],
  "a repeated VALUES variable": [
    "SELECT * WHERE { VALUES (?x ?x) { (1 2) } }",
    /more than once/,
  ],
  "an aggregate in FILTER": [
    "SELECT * WHERE { ?s ?p ?o FILTER(COUNT(?o) > 1) }",
    /only allowed/,
  ],
  "a nested aggregate": [
    "SELECT (SUM(COUNT(?o)) AS ?x) WHERE { ?s ?p ?o }",
    /only allowed/,
  ],
  "a blank node in two groups": [
    "SELECT * WHERE { _:a ?p ?o OPTIONAL { _:a ?q ?r } }",
    /reuse of blank node/,
  ],
  "a blank node inside EXISTS": [
    "SELECT * WHERE { _:a ?p ?o FILTER EXISTS { _:a ?q ?r } }",
    /reuse of blank node/,
  ],
  "SUBSTR with one argument": [
    'SELECT * WHERE { FILTER(SUBSTR("a")) }',
    /takes 2 or 3 arguments/,
  ],
  "REPLACE with two arguments": [
    'SELECT * WHERE { BIND(REPLACE("a", "a") AS ?r) }',
    /takes 3 or 4 arguments/,
  ],
};

for (const [name, [query, message]] of Object.entries(rejected)) {
  test(`validation rejects ${name}`, () => {
    assert.throws(() => parse(query), message);
  });
}

const accepted: Record<string, string> = {
  "an alias built on an earlier aggregate":
    "SELECT (COUNT(?o) AS ?n) (?n + 1 AS ?m) WHERE { ?s ?p ?o }",
  "a group key beside an earlier alias":
    "SELECT ?s (COUNT(?o) AS ?n) (CONCAT(STR(?s), STR(?n)) AS ?m) WHERE { ?s ?p ?o } GROUP BY ?s",
  "a cast around an aggregate":
    "SELECT (xsd:integer(COUNT(?o)) AS ?n) WHERE { ?s ?p ?o }",
  "an alias over a variable only MINUS or FILTER EXISTS mentions":
    "SELECT (1 AS ?z) WHERE { ?s ?p ?o MINUS { ?s ?q ?z } }",
  "BIND over a variable only MINUS mentions":
    "SELECT * WHERE { ?s ?p ?o MINUS { ?s ?q ?z } BIND(1 AS ?z) }",
  "BIND in a nested group": "SELECT * WHERE { ?s ?p ?o { BIND(1 AS ?o) } }",
  "BIND in each UNION branch":
    "SELECT * WHERE { { BIND(1 AS ?o) } UNION { BIND(2 AS ?o) } }",
  "a blank node across a FILTER":
    "SELECT * WHERE { _:a ?p ?o FILTER(true) _:a ?q ?r }",
  "the same label in two update operations":
    "DELETE { ?s ?p ?o } WHERE { _:a ?p ?o . ?s ?p ?o } ; DELETE { ?s ?p ?o } WHERE { _:a ?p ?o . ?s ?p ?o }",
  "a blank node in both template and pattern":
    "CONSTRUCT { _:a ?p ?o } WHERE { _:a ?p ?o }",
};

for (const [name, query] of Object.entries(accepted)) {
  test(`validation accepts ${name}`, () => {
    assert.ok(parse(query));
  });
}

test("skipValidation turns the checks off", () => {
  const lenient = new Parser({ skipValidation: true });
  assert.ok(lenient.parse("SELECT ?o (COUNT(*) AS ?n) WHERE { ?s ?p ?o }"));
});

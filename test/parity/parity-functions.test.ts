import { DataFactory } from "@/term/mod.ts";
import { assertQueryParity } from "./parity-harness.ts";

const { literal, namedNode, quad } = DataFactory;

Deno.test("parity - BIND filter scoping", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?p ?o ?z WHERE {
  ?s ?p ?o .
  FILTER(?z = 3)
  BIND(?o + 1 AS ?z)
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s"),
      namedNode("http://example.org/p"),
      literal("2", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
  ];
  await assertQueryParity({
    name: "BIND filter scoping",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - GROUP BY function expression", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?g (COUNT(?p) AS ?cnt) WHERE {
  ?s :p ?p .
} GROUP BY (DATATYPE(?p) AS ?g)`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      literal("123", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/p"),
      literal("hello"),
    ),
  ];
  await assertQueryParity({
    name: "GROUP BY function expression",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - ISNUMERIC built-in function", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?p ?isNum WHERE {
  ?s :p ?p .
  BIND(isNumeric(?p) AS ?isNum)
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      literal("123", namedNode("http://www.w3.org/2001/XMLSchema#integer")),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/p"),
      literal("hello"),
    ),
  ];
  await assertQueryParity({
    name: "ISNUMERIC parity",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - ENCODE_FOR_URI function", async () => {
  const query =
    `SELECT ?encoded WHERE { BIND(ENCODE_FOR_URI("hello world! / foo&bar") AS ?encoded) }`;
  await assertQueryParity({
    name: "ENCODE_FOR_URI parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - IRI and URI function", async () => {
  const query =
    `SELECT ?iri ?uri WHERE { BIND(IRI("http://example.org/test") AS ?iri) BIND(URI("http://example.org/test2") AS ?uri) }`;
  await assertQueryParity({
    name: "IRI and URI parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - request-level baseIri resolves relative IRIs (no BASE directive)", async () => {
  const query = `SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`;
  await assertQueryParity({
    name: "request baseIri resolves relative IRIs",
    kind: "select",
    query,
    quads: [],
    baseIri: "http://example.org/root/",
  });
});

Deno.test("parity - BASE directive wins over request-level baseIri", async () => {
  const query = `BASE <http://directive.example/>
SELECT ?iri WHERE { BIND(IRI("rel/path") AS ?iri) }`;
  await assertQueryParity({
    name: "BASE directive wins over request baseIri",
    kind: "select",
    query,
    quads: [],
    baseIri: "http://request.example/",
  });
});

Deno.test("parity - relative PREFIX IRI resolves against request baseIri", async () => {
  const query = `PREFIX ex: <relative/ns#>
SELECT ?s WHERE { ?s ex:p ?o }`;
  await assertQueryParity({
    name: "relative PREFIX resolves against request baseIri",
    kind: "select",
    query,
    quads: [
      quad(
        namedNode("http://example.org/root/relative/ns#s1"),
        namedNode("http://example.org/root/relative/ns#p"),
        namedNode("http://example.org/o1"),
      ),
    ],
    baseIri: "http://example.org/root/",
  });
});

Deno.test("parity - TZ function", async () => {
  const query = `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?tz1 ?tz2 WHERE {
  BIND(TZ("2011-01-10T14:45:13-05:00"^^xsd:dateTime) AS ?tz1)
  BIND(TZ("2011-01-10T14:45:13Z"^^xsd:dateTime) AS ?tz2)
}`;
  await assertQueryParity({
    name: "TZ parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - non-BMP STRLEN and SUBSTR", async () => {
  const query = `SELECT ?len ?sub WHERE {
  BIND(STRLEN("𐍈bar") AS ?len)
  BIND(SUBSTR("𐍈bar", 1, 2) AS ?sub)
}`;
  await assertQueryParity({
    name: "non-BMP STRLEN and SUBSTR parity",
    kind: "select",
    query,
    quads: [],
  });
});

Deno.test("parity - path - negated property set direct and inverse", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?o WHERE {
  ?s !(:p|^:q) ?o
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/o1"),
    ),
    quad(
      namedNode("http://example.org/s2"),
      namedNode("http://example.org/q"),
      namedNode("http://example.org/o2"),
    ),
    quad(
      namedNode("http://example.org/sa"),
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode("http://example.org/oa"),
    ),
    quad(
      namedNode("http://example.org/sp"),
      namedNode("http://example.org/p2"),
      namedNode("http://example.org/op"),
    ),
  ];
  await assertQueryParity({
    name: "negated property set direct and inverse parity",
    kind: "select",
    query,
    quads,
  });
});

Deno.test("parity - subquery in WHERE clause", async () => {
  const query = `PREFIX : <http://example.org/>
SELECT ?s ?o WHERE {
  ?s :p ?mid .
  { SELECT ?mid ?o WHERE { ?mid :q ?o } }
}`;
  const quads = [
    quad(
      namedNode("http://example.org/s1"),
      namedNode("http://example.org/p"),
      namedNode("http://example.org/m1"),
    ),
    quad(
      namedNode("http://example.org/m1"),
      namedNode("http://example.org/q"),
      namedNode("http://example.org/o1"),
    ),
  ];
  await assertQueryParity({
    name: "subquery in WHERE clause parity",
    kind: "select",
    query,
    quads,
  });
});

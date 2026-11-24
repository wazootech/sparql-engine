import {
  bindValue,
  emptyEngine,
  XSD,
} from "@/wazoo-sparql-engine-test-helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("WazooSparqlEngine - COALESCE, IF, IN, NOT IN, SAMETERM", async () => {
  const engine = emptyEngine();
  const coalesce = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(COALESCE(?missing, 1/0, "x") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(coalesce, { type: "literal", value: "x" });
  const ifFalse = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(IF(false, 1, 2) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(ifFalse, {
    type: "literal",
    value: "2",
    datatype: `${XSD}integer`,
  });
  const inErr = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 IN (2, ?missing) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(inErr, null);
  const inErrHit = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 IN (1, ?missing) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(inErrHit, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const notin = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(1 NOT IN () AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(notin, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const same = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SAMETERM(1, "1") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(same, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
});

test("WazooSparqlEngine - BNODE mints fresh and labeled blank nodes", async () => {
  const engine = emptyEngine();
  const fresh = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE() AS ?a) BIND(BNODE() AS ?b) }`,
    "a",
  );
  const freshB = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE() AS ?a) BIND(BNODE() AS ?b) }`,
    "b",
  );
  assert.deepStrictEqual(fresh?.type, "bnode");
  assert.deepStrictEqual(freshB?.type, "bnode");
  // Zero-argument BNODE mints a fresh node per call.
  if (fresh !== null && freshB !== null) {
    if (fresh.value === freshB.value) {
      throw new Error("BNODE() must mint a fresh node per call");
    }
  }
  // BNODE("x") with the same label yields the same node within a query.
  const labeled = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE("x") AS ?a) BIND(BNODE("x") AS ?b) }`,
    "a",
  );
  const labeledB = await bindValue(
    engine,
    `SELECT ?a ?b WHERE { BIND(BNODE("x") AS ?a) BIND(BNODE("x") AS ?b) }`,
    "b",
  );
  assert.deepStrictEqual(labeled?.type, "bnode");
  assert.deepStrictEqual(labeled?.value, labeledB?.value);
});

test("WazooSparqlEngine - ABS, CEIL, FLOOR, ROUND preserve the datatype", async () => {
  const engine = emptyEngine();
  const absInt = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ABS(-2) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(absInt, {
    type: "literal",
    value: "2",
    datatype: `${XSD}integer`,
  });
  const absDec = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ABS(-2.5) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(absDec, {
    type: "literal",
    value: "2.5",
    datatype: `${XSD}decimal`,
  });
  const ceil = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(CEIL(2.5) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(ceil, {
    type: "literal",
    value: "3",
    datatype: `${XSD}decimal`,
  });
  const roundNeg = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ROUND(-2.5) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(roundNeg, {
    type: "literal",
    value: "-2",
    datatype: `${XSD}decimal`,
  });
  const roundDouble = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ROUND(2.5e0) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(roundDouble, {
    type: "literal",
    value: "3.0E0",
    datatype: `${XSD}double`,
  });
});

test("WazooSparqlEngine - date functions over xsd:dateTime", async () => {
  const engine = emptyEngine();
  const dt = `"2011-01-10T14:45:13.815-05:00"^^<${XSD}dateTime>`;
  const year = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(YEAR(${dt}) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(year, {
    type: "literal",
    value: "2011",
    datatype: `${XSD}integer`,
  });
  const seconds = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SECONDS(${dt}) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(seconds, {
    type: "literal",
    value: "13.815",
    datatype: `${XSD}decimal`,
  });
  const tz = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(TIMEZONE(${dt}) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(tz, {
    type: "literal",
    value: "-PT5H",
    datatype: `${XSD}dayTimeDuration`,
  });
  // A literal without a timezone is an error (unbound).
  const none = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(TIMEZONE("2011-01-10T14:45:13"^^<${XSD}dateTime>) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(none, null);
  // A plain string is not an xsd:dateTime.
  const plain = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(YEAR("2011-01-10T14:45:13") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(plain, null);
});

test("WazooSparqlEngine - MD5 and SHA digests", async () => {
  const engine = emptyEngine();
  const checks: Array<[string, string]> = [
    ["MD5", "900150983cd24fb0d6963f7d28e17f72"],
    ["SHA1", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    [
      "SHA256",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      "SHA384",
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    ],
    [
      "SHA512",
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    ],
  ];
  for (const [fn, digest] of checks) {
    const value = await bindValue(
      engine,
      `SELECT ?v WHERE { BIND(${fn}("abc") AS ?v) }`,
      "v",
    );
    assert.deepStrictEqual(value, { type: "literal", value: digest });
  }
});

test("WazooSparqlEngine - RDF-star expression functions", async () => {
  const engine = emptyEngine();
  const triple = await bindValue(
    engine,
    `SELECT ?t WHERE { BIND(TRIPLE(<http://s>, <http://p>, "o") AS ?t) }`,
    "t",
  );
  assert.deepStrictEqual(triple?.type, "triple");
  const subject = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SUBJECT(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(subject, { type: "uri", value: "http://s" });
  const object = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(OBJECT(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(object, { type: "literal", value: "o" });
  const isTriple = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(isTRIPLE(TRIPLE(<http://s>, <http://p>, "o")) AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(isTriple, {
    type: "literal",
    value: "true",
    datatype: `${XSD}boolean`,
  });
  const notTriple = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(isTRIPLE("x") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(notTriple, {
    type: "literal",
    value: "false",
    datatype: `${XSD}boolean`,
  });
  const err = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(SUBJECT("x") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(err, null);
});

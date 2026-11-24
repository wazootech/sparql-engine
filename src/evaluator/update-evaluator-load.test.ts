import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { namedNode } = DataFactory;

test("UpdateEvaluator - LOAD then reified patterns match grammar reifier output", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const file = `${dir}/data.ttl`;
  await writeFile(
    file,
    `
    @prefix : <http://example.com/ns#> .
    :s :p :o ~ :iri {| :r :Z1 |} .
    :s :p :o2 ~ {| :r :Z2 |} .
    :r1 :reifies <<( :a :b <<( :d :e :f )>> )>> .
  `,
  );

  await engine.execute({ query: `LOAD <file://${file.replace(/\\/g, "/")}>` });

  // The jison grammar emits `reifier rdf:reifies <<( s p o )>>` for a reified
  // triple, and annotation blocks attach to the reifier; the evaluator's
  // reified.ts expansion must agree with that shape.
  let result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ :iri {| :r ?Z |} }",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      result.data.results.bindings[0].o.value,
      "http://example.com/ns#o",
    );
    assert.deepStrictEqual(
      result.data.results.bindings[0].Z.value,
      "http://example.com/ns#Z1",
    );
  }

  // A variable reifier binds both the explicit IRI reifier and the fresh
  // blank-node reifier the grammar minted for the bare `~`.
  result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT * { :s :p ?o ~ ?r {| :r ?Z |} }",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.results.bindings.length, 2);
  }

  // A data triple term (including a nested one) in object position matches
  // the grammar's plain-Quad triple terms.
  result = await engine.execute({
    query:
      "PREFIX : <http://example.com/ns#> SELECT ?r WHERE { ?r :reifies <<( :a :b <<( :d :e :f )>> )>> }",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.results.bindings.length, 1);
    assert.deepStrictEqual(
      result.data.results.bindings[0].r.value,
      "http://example.com/ns#r1",
    );
  }
});

test("UpdateEvaluator - LOAD keeps blank nodes distinct across documents", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const fileA = `${dir}/a.ttl`;
  const fileB = `${dir}/b.ttl`;
  await writeFile(
    fileA,
    '@prefix : <http://ex/> . _:b1 :name "Alice" . _:b1 :friend _:b2 .',
  );
  await writeFile(fileB, '@prefix : <http://ex/> . _:b1 :name "Bob" .');

  await engine.execute({ query: `LOAD <file://${fileA.replace(/\\/g, "/")}>` });
  await engine.execute({ query: `LOAD <file://${fileB.replace(/\\/g, "/")}>` });

  // Blank node labels are document-scoped: the two documents' `_:b1` must
  // stay distinct, and each document's internal structure must be preserved.
  const result = await engine.execute({
    query: "PREFIX : <http://ex/> SELECT * { ?x :name ?n }",
  });
  assert.deepStrictEqual(result.kind, "select");
  if (result.kind === "select") {
    assert.deepStrictEqual(result.data.results.bindings.length, 2);
    const byName = new Map(
      result.data.results.bindings.map((b) => [b.n.value, b.x.value]),
    );
    assert.notDeepStrictEqual(byName.get("Alice"), byName.get("Bob"));
  }
  assert.deepStrictEqual(store.countQuads(null, null, null, null), 3);
});

test("UpdateEvaluator - LOAD preserves directional literals and keeps directions distinct", async () => {
  const store = new Store();
  const engine = new WazooSparqlEngine({ store });

  const dir = await mkdtemp(join(tmpdir(), "sparql-engine-"));
  const file = `${dir}/data.ttl`;
  await writeFile(
    file,
    `@prefix : <http://ex/> .
     :a :label "same"@en--ltr, "same"@en--rtl, "same"@en .`,
  );

  await engine.execute({ query: `LOAD <file://${file.replace(/\\/g, "/")}>` });

  const labels = store
    .getQuads(
      namedNode("http://ex/a"),
      namedNode("http://ex/label"),
      null,
      null,
    )
    .map((q) => q.object as rdfjs.Literal);
  assert.deepStrictEqual(labels.length, 3);
  const dirs = labels.map((l) => l.direction ?? "").sort();
  assert.deepStrictEqual(dirs, ["", "ltr", "rtl"]);
  for (const l of labels) {
    assert.deepStrictEqual(l.language, "en");
    assert.deepStrictEqual(
      l.datatype.value,
      l.direction
        ? "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString"
        : "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
    );
  }
});

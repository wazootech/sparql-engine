import { encodeForUri } from "@/evaluator/encode-for-uri.ts";
import { bindValue, emptyEngine } from "@/wazoo-sparql-engine-test-helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("encodeForUri percent-encodes everything except the unreserved characters", () => {
  // fn:encode-for-uri examples (XPath F&O 3.1 §6.2.2) plus the five characters
  // encodeURIComponent leaves alone.
  assert.equal(
    encodeForUri("http://www.example.com/00/Weather/CA/Los%20Angeles#ocean"),
    "http%3A%2F%2Fwww.example.com%2F00%2FWeather%2FCA%2FLos%2520Angeles%23ocean",
  );
  assert.equal(encodeForUri("~bébé"), "~b%C3%A9b%C3%A9");
  assert.equal(encodeForUri("100% organic"), "100%25%20organic");
  assert.equal(encodeForUri("!'()*"), "%21%27%28%29%2A");
  assert.equal(encodeForUri("A-Za-z0-9-_.~"), "A-Za-z0-9-_.~");
  assert.equal(encodeForUri(""), "");
});

test("encodeForUri reports a lone surrogate as an error", () => {
  assert.equal(encodeForUri("\ud800"), undefined);
});

test("WazooSparqlEngine - ENCODE_FOR_URI encodes reserved characters", async () => {
  const engine = emptyEngine();
  const encoded = await bindValue(
    engine,
    `SELECT ?v WHERE { BIND(ENCODE_FOR_URI("hello world! / foo&bar") AS ?v) }`,
    "v",
  );
  assert.deepStrictEqual(encoded, {
    type: "literal",
    value: "hello%20world%21%20%2F%20foo%26bar",
  });
});

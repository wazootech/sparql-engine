import assert from "node:assert/strict";
import { test } from "node:test";
import { rejected } from "../../test/thrown.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type {
  LoadFetch,
  LoadHttpResponse,
  LoadPolicy,
} from "@/evaluator/load-policy.ts";
import { isBlockedAddress } from "@/evaluator/load-policy.ts";

const TURTLE = "<http://ex/s> <http://ex/p> <http://ex/o> .";

function reply(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): LoadHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
}

/** run loads url through an engine whose fetch is a recording fake. */
function run(
  url: string,
  policy: LoadPolicy | undefined,
  respond: (url: string) => LoadHttpResponse,
) {
  const calls: string[] = [];
  const fetch: LoadFetch = (target) => {
    calls.push(target);
    return Promise.resolve(respond(target));
  };
  const store = new Store();
  const engine = new WazooSparqlEngine({
    store,
    loadPolicy: policy === undefined ? undefined : { ...policy, fetch },
  });
  const outcome = engine.execute({ query: `LOAD <${url}>` });
  return { calls, outcome, engine };
}

test("LOAD of a remote URL is denied without a policy", async () => {
  const { calls, outcome } = run(
    "https://data.example/a.ttl",
    undefined,
    () => reply(200, TURTLE),
  );
  await rejected(() => outcome, Error, "not permitted by policy");
  assert.deepStrictEqual(calls.length, 0);
});

test("LOAD denies hosts outside the allowlist", async () => {
  const { calls, outcome } = run(
    "https://other.example/a.ttl",
    { allowedHosts: ["data.example"] },
    () => reply(200, TURTLE),
  );
  await rejected(() => outcome, Error, "not permitted by policy");
  assert.deepStrictEqual(calls.length, 0);
});

test("LOAD blocks internal IP literals even when allowlisted", async () => {
  for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "[::1]"]) {
    const { calls, outcome } = run(
      `https://${host}/a.ttl`,
      { allowedHosts: [host.replace(/^\[|\]$/g, "")] },
      () => reply(200, TURTLE),
    );
    await rejected(() => outcome, Error, "blocked address");
    assert.deepStrictEqual(calls.length, 0);
  }
});

test("LOAD blocks a host that resolves to an internal address", async () => {
  const { calls, outcome } = run(
    "https://data.example/a.ttl",
    {
      allowedHosts: ["data.example"],
      resolveHost: () => Promise.resolve(["10.1.2.3"]),
    },
    () => reply(200, TURTLE),
  );
  await rejected(() => outcome, Error, "blocked address");
  assert.deepStrictEqual(calls.length, 0);
});

test("LOAD blocks a redirect to an internal address", async () => {
  const { calls, outcome } = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example", "169.254.169.254"] },
    (url) =>
      url.startsWith("https://data.example")
        ? reply(302, "", { location: "https://169.254.169.254/latest" })
        : reply(200, TURTLE),
  );
  await rejected(() => outcome, Error, "blocked address");
  assert.deepStrictEqual(calls, ["https://data.example/a.ttl"]);
});

test("LOAD blocks a redirect to a host outside the allowlist", async () => {
  const { calls, outcome } = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example"] },
    () => reply(301, "", { location: "https://evil.example/x" }),
  );
  await rejected(() => outcome, Error, "not permitted by policy");
  assert.deepStrictEqual(calls.length, 1);
});

test("LOAD refuses plain http unless allowHttp is set", async () => {
  const { outcome } = run(
    "http://data.example/a.ttl",
    { allowedHosts: ["data.example"] },
    () => reply(200, TURTLE),
  );
  await rejected(() => outcome, Error, "requires https");
});

test("LOAD enforces the byte and quad limits", async () => {
  const big = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example"], maxBytes: 10 },
    () => reply(200, TURTLE),
  );
  await rejected(() => big.outcome, Error, "size limit");
  const many = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example"], maxQuads: 0 },
    () => reply(200, TURTLE),
  );
  await rejected(() => many.outcome, Error, "quad limit");
});

test("LOAD does not echo a non-RDF body in the error", async () => {
  const { outcome } = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example"] },
    () => reply(200, "SECRET-INTERNAL-PAYLOAD <<<"),
  );
  const error = await outcome.catch((caught: Error) => caught);
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes("SECRET"));
});

test("LOAD still works for an allowlisted https host and follows a safe redirect", async () => {
  const { calls, outcome, engine } = run(
    "https://data.example/a.ttl",
    { allowedHosts: ["data.example", "cdn.example"] },
    (url) =>
      url.startsWith("https://data.example")
        ? reply(302, "", { location: "https://cdn.example/a.ttl" })
        : reply(200, TURTLE),
  );
  await outcome;
  assert.deepStrictEqual(calls.length, 2);
  const result = await engine.execute({
    query: "ASK { <http://ex/s> <http://ex/p> <http://ex/o> }",
  });
  assert.deepStrictEqual(result.kind === "ask" && result.data.boolean, true);
});

test("isBlockedAddress covers private, mapped and public ranges", () => {
  for (
    const blocked of [
      "0.0.0.0",
      "172.16.0.1",
      "192.168.1.1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
    ]
  ) {
    assert.ok(isBlockedAddress(blocked), blocked);
  }
  for (const open of ["8.8.8.8", "93.184.216.34", "2606:4700::1"]) {
    assert.ok(!isBlockedAddress(open), open);
  }
});

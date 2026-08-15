/**
 * interface-parity asserts that `src/sparql-engine-interface.ts` stays
 * identical to `@worlds/client`'s copy under the identical-spec policy.
 *
 * The engine's public envelopes (`SparqlEngineInterface`, `SparqlRequest`,
 * `SparqlResponse`, and the result shapes) are duplicated in both packages and
 * must not drift. This fetches the canonical copy from `worlds-client-ts`
 * `main` and diffs it against the local file (line endings normalized), so a
 * single-sided edit fails CI here instead of silently forking the contract.
 */

const WORLDS_INTERFACE_URL =
  "https://raw.githubusercontent.com/wazootech/worlds-client-ts/main/src/client/sparql-engine/sparql-engine-interface.ts";

const LOCAL_INTERFACE = new URL(
  "../src/sparql-engine-interface.ts",
  import.meta.url,
);

/** normalize collapses CRLF and trailing whitespace so only real drift fails. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

const local = normalize(await Deno.readTextFile(LOCAL_INTERFACE));

const response = await fetch(WORLDS_INTERFACE_URL);
if (!response.ok) {
  console.error(
    `interface-parity: failed to fetch @worlds/client interface (HTTP ${response.status})`,
  );
  Deno.exit(1);
}
const remote = normalize(await response.text());

if (local !== remote) {
  console.error(
    "interface-parity: src/sparql-engine-interface.ts differs from " +
      "@worlds/client's copy. Update both packages together under the " +
      "identical-spec policy.",
  );
  Deno.exit(1);
}

console.log("interface-parity: SparqlEngineInterface copies match.");

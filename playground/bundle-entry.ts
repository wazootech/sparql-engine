/**
 * Bundle entrypoint for the playground page.
 *
 * `deno task bundle` vendors the published engine from JSR into a single
 * `app.js` next to `index.html`, so the page runs offline from `file://` and
 * any static host with no CDN dependency at runtime. Keep the re-export list
 * in sync with the imports in `index.html`.
 */
export {
  MemoryStore,
  parseTurtleQuads,
  serializeJsonResults,
  serializeTurtle,
  WazooSparqlEngine,
} from "jsr:@wazoo/sparql-engine@0.4.1";

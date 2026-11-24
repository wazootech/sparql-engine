/**
 * Bundle entrypoint for the playground page.
 *
 * `bun run bundle` vendors the published engine (the pinned
 * `@wazoo/sparql-engine-published` devDependency, an npm alias of JSR's
 * `@jsr/wazoo__sparql-engine`) into a single `app.js` next to `index.html`, so
 * the page runs offline from `file://` and any static host with no CDN
 * dependency at runtime. Keep the re-export list in sync with the imports in
 * `index.html`.
 */
export {
  MemoryStore,
  parseTurtleQuads,
  serializeJsonResults,
  serializeTurtle,
  WazooSparqlEngine,
} from "@wazoo/sparql-engine-published";

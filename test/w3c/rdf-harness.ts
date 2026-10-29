import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { Parser as N3Parser } from "n3";
export { quadSetsIsomorphic } from "./rdf-isomorphism.ts";
export { quadSetsIsomorphicAsSets } from "./rdf-isomorphism.ts";

/**
 * Shared plumbing for the RDF 1.1 differential gate and the RDF 1.2 manifest
 * classifier. The fixtures under test/w3c/fixtures/ mirror the upstream
 * w3c/rdf-tests tree, so every on-disk path maps 1:1 to a canonical
 * `https://w3c.github.io/rdf-tests/…` URL. Relative IRIs in the test files
 * resolve against that canonical URL (matching the W3C harness), which is what
 * makes wazoo output comparable to the `.nt` reference results.
 */

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const RDFT = "http://www.w3.org/ns/rdftest#";

export const CANONICAL_ROOT = "https://w3c.github.io/rdf-tests/";

/** Maps an on-disk path (relative to the fixtures/rdf root) to its canonical URL. */
export function canonicalOf(diskRelPath: string): string {
  return `${CANONICAL_ROOT}${diskRelPath}`;
}

/** Maps a canonical `https://w3c.github.io/rdf-tests/…` URL back to a disk path. */
export function diskOf(url: string): string {
  if (!url.startsWith(CANONICAL_ROOT)) {
    throw new Error(
      `RDF fixture IRI ${url} is not under the canonical root ${CANONICAL_ROOT}; ` +
        `cannot map it to a vendored fixture.`,
    );
  }
  return url.slice(CANONICAL_ROOT.length);
}

export type RdfFormat = "Turtle" | "TriG" | "N-Triples" | "N-Quads";
export type RdfSyntaxKind = "positive" | "negative" | "eval";

export interface RdfSyntaxCase {
  /** `<suite>:<category>:<local-name>` — also the allowlist key. */
  id: string;
  suite: "rdf11" | "rdf12";
  format: RdfFormat;
  name: string;
  kind: RdfSyntaxKind;
  approval: "Approved" | "Proposed" | "unknown";
  /** Disk path of the action file, relative to the fixtures/rdf root. */
  action: string;
  /** Canonical URL of the action file (base for relative-IRI resolution). */
  actionUrl: string;
  /** Disk path of the mf:result file, for eval tests only. */
  result: string | null;
}

interface TypeInfo {
  kind: RdfSyntaxKind;
  format: RdfFormat;
}

/** rdf:type IRI → (kind, format). Only RDF syntax test types are classified. */
const TYPE_MAP = new Map<string, TypeInfo>([
  // Turtle.
  [`${RDFT}TestTurtleEval`, { kind: "eval", format: "Turtle" }],
  [`${RDFT}TestTurtlePositiveSyntax`, { kind: "positive", format: "Turtle" }],
  [`${RDFT}TestTurtleNegativeSyntax`, { kind: "negative", format: "Turtle" }],
  // TriG.
  [`${RDFT}TestTrigEval`, { kind: "eval", format: "TriG" }],
  [`${RDFT}TestTrigPositiveSyntax`, { kind: "positive", format: "TriG" }],
  [`${RDFT}TestTrigNegativeSyntax`, { kind: "negative", format: "TriG" }],
  // N-Triples.
  [`${RDFT}TestNTriplesPositiveSyntax`, {
    kind: "positive",
    format: "N-Triples",
  }],
  [`${RDFT}TestNTriplesNegativeSyntax`, {
    kind: "negative",
    format: "N-Triples",
  }],
  // N-Quads.
  [`${RDFT}TestNQuadsPositiveSyntax`, { kind: "positive", format: "N-Quads" }],
  [`${RDFT}TestNQuadsNegativeSyntax`, { kind: "negative", format: "N-Quads" }],
]);

function namedNode(value: string): rdfjs.NamedNode {
  return DataFactory.namedNode(value);
}

/** Walks an RDF list (rdf:first/rdf:rest) collecting its members. */
function listTerms(store: MemoryStore, head: rdfjs.Term): rdfjs.Term[] {
  const terms: rdfjs.Term[] = [];
  let node = head;
  const seen = new Set<string>();
  while (node.termType !== "NamedNode" || node.value !== RDF + "nil") {
    const key = `${node.termType}:${node.value}`;
    if (seen.has(key) || node.termType === "Literal") break;
    seen.add(key);
    const first = store.getQuads(node, namedNode(RDF + "first"), null, null)[0];
    if (!first) break;
    terms.push(first.object);
    const rest = store.getQuads(node, namedNode(RDF + "rest"), null, null)[0];
    if (!rest) break;
    node = rest.object;
  }
  return terms;
}

function localId(subject: rdfjs.Term, name: string): string {
  if (subject.termType === "NamedNode") {
    return subject.value.split(/[#/]/).pop() ?? subject.value;
  }
  return name;
}

/**
 * loadRdfManifest parses one RDF syntax-test manifest and returns its cases.
 * `manifestRel` is the manifest's disk path relative to the fixtures/rdf root
 * (its canonical URL doubles as the parse base, so mf:action/mf:result and
 * mf:include resolve to canonical URLs). `mf:include` references are followed
 * recursively; a referenced manifest that is not vendored is a hard error (the
 * loader never silently drops a test).
 */
export interface RdfManifestLoad {
  cases: RdfSyntaxCase[];
  skipped: number;
}

export function loadRdfManifest(manifestRel: string): RdfManifestLoad {
  const store = new MemoryStore();

  const loadInto = (rel: string): void => {
    let text: string;
    try {
      text = Deno.readTextFileSync(`test/w3c/fixtures/${rel}`);
    } catch (error) {
      throw new Error(
        `failed to read RDF manifest ${rel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const parser = new N3Parser({ baseIRI: canonicalOf(rel) });
    for (const quad of parser.parse(text)) store.addQuad(quad);
  };
  loadInto(manifestRel);

  const cases: RdfSyntaxCase[] = [];
  let skipped = 0;

  const manifestSubjects = store.getQuads(
    null,
    namedNode(RDF + "type"),
    namedNode(MF + "Manifest"),
    null,
  ).map((q) => q.subject);

  const queue: rdfjs.Term[] = [...manifestSubjects];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const manifest = queue.shift()!;
    const mkey = `${manifest.termType}:${manifest.value}`;
    if (seen.has(mkey)) continue;
    seen.add(mkey);

    for (
      const include of store.getQuads(
        manifest,
        namedNode(MF + "include"),
        null,
        null,
      )
    ) {
      if (include.object.termType !== "NamedNode") continue;
      const includedRel = diskOf(include.object.value);
      loadInto(includedRel);
      queue.push(include.object);
    }

    for (
      const entries of store.getQuads(
        manifest,
        namedNode(MF + "entries"),
        null,
        null,
      )
    ) {
      for (const entry of listTerms(store, entries.object)) {
        const info = classifyEntry(store, entry);
        if (!info) {
          skipped += 1;
          continue;
        }
        const nameQuad = store.getQuads(
          entry,
          namedNode(MF + "name"),
          null,
          null,
        )[0];
        const name = nameQuad ? nameQuad.object.value : localId(entry, "?");
        const actionQuad = store.getQuads(
          entry,
          namedNode(MF + "action"),
          null,
          null,
        )[0];
        if (!actionQuad || actionQuad.object.termType !== "NamedNode") {
          skipped += 1;
          continue;
        }
        const actionUrl = actionQuad.object.value;
        let result: string | null = null;
        if (info.kind === "eval") {
          const resultQuad = store.getQuads(
            entry,
            namedNode(MF + "result"),
            null,
            null,
          )[0];
          if (resultQuad && resultQuad.object.termType === "NamedNode") {
            result = diskOf(resultQuad.object.value);
          }
        }
        const approvalQuad = store.getQuads(
          entry,
          namedNode(RDFT + "approval"),
          null,
          null,
        )[0];
        const approval = approvalQuad?.object.termType === "NamedNode"
          ? approvalQuad.object.value.endsWith("Approved")
            ? "Approved"
            : approvalQuad.object.value.endsWith("Proposed")
            ? "Proposed"
            : "unknown"
          : "unknown";

        const match = manifestRel.match(
          /^rdf\/(rdf11|rdf12)\/(.+)\/manifest\.ttl$/,
        );
        const suite = match ? match[1] as "rdf11" | "rdf12" : "rdf12";
        const category = match
          ? match[2]
          : manifestRel.replace(/\/manifest\.ttl$/, "");
        cases.push({
          id: `${suite}:${category}:${localId(entry, name)}`,
          suite,
          format: info.format,
          name,
          kind: info.kind,
          approval,
          action: diskOf(actionUrl),
          actionUrl,
          result,
        });
      }
    }
  }

  return { cases, skipped };
}

function classifyEntry(
  store: MemoryStore,
  entry: rdfjs.Term,
): TypeInfo | null {
  for (
    const quad of store.getQuads(entry, namedNode(RDF + "type"), null, null)
  ) {
    if (quad.object.termType !== "NamedNode") continue;
    const info = TYPE_MAP.get(quad.object.value);
    if (info) return info;
  }
  return null;
}

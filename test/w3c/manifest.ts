import type * as rdfjs from "@rdfjs/types";
import {
  MF,
  MF_ACTION,
  MF_ENTRIES,
  MF_INCLUDE,
  MF_NAME,
  MF_RESULT,
  QT_DATA,
  QT_GRAPHDATA,
  QT_QUERY,
  RDF_TYPE,
  TYPE_NEG_SYNTAX,
  TYPE_NEG_SYNTAX_LEGACY,
  TYPE_POS_SYNTAX,
  TYPE_POS_SYNTAX_LEGACY,
  TYPE_QUERY_EVAL,
  TYPE_UPDATE_EVAL,
  UT_DATA,
  UT_GRAPH,
  UT_GRAPHDATA,
  UT_REQUEST,
} from "./manifest-vocab.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { Parser as N3Parser } from "n3";
import type { W3cTestCase } from "./manifest-types.ts";
import {
  collectGraphData,
  collectValues,
  filePath,
  listTerms,
  rdfjsNamedNode,
} from "./manifest-helpers.ts";
export type { W3cGraphData } from "./manifest-types.ts";
export type { W3cTestCase } from "./manifest-types.ts";

/**
 * parseTestCase resolves one manifest entry into a W3cTestCase.
 * All file references resolve against the category's fixtures directory.
 */
function parseTestCase(
  store: MemoryStore,
  category: string,
  subject: rdfjs.Term,
  action: rdfjs.Term | null,
): W3cTestCase | null {
  const typeQuads: rdfjs.Quad[] = store.getQuads(
    subject,
    rdfjsNamedNode(RDF_TYPE),
    null,
    null,
  );
  const types = typeQuads
    .map((quad) => quad.object)
    .filter((term): term is rdfjs.NamedNode => term.termType === "NamedNode")
    .map((term) => term.value);

  const isQueryEval = types.includes(TYPE_QUERY_EVAL);
  const isUpdateEval = types.includes(TYPE_UPDATE_EVAL);
  const negativeSyntax = types.includes(TYPE_NEG_SYNTAX) ||
    types.includes(TYPE_NEG_SYNTAX_LEGACY);
  const positiveSyntax = types.includes(TYPE_POS_SYNTAX) ||
    types.includes(TYPE_POS_SYNTAX_LEGACY);

  // NegativeSyntaxTest11 and PositiveSyntaxTest11 entries are query syntax tests;
  // treat them as query-kind tests.
  if (!isQueryEval && !isUpdateEval && !negativeSyntax && !positiveSyntax) {
    return null;
  }

  const nameQuad =
    store.getQuads(subject, rdfjsNamedNode(MF_NAME), null, null)[0];
  const name = nameQuad ? nameQuad.object.value : subject.value;

  const localId = subject.termType === "NamedNode"
    ? subject.value.split(/[#/]/).pop() ?? subject.value
    : name;

  const resultQuad =
    store.getQuads(subject, rdfjsNamedNode(MF_RESULT), null, null)[0];
  let resultFile: string | null = null;
  if (resultQuad) {
    const result = resultQuad.object;
    if (result.termType === "NamedNode") {
      // Graph results (.ttl/.nt), JSON results (.srj), and XML results
      // (.srx) all land here; the runner routes each by extension.
      const name = result.value.split("/").pop() ?? "";
      if (/\.(ttl|nt|trig|nq|srj|srx)$/.test(name)) {
        resultFile = name;
      }
    } else if (result.termType === "BlankNode") {
      // mf:result [ ut:data <post.ttl> ] — the expected update post-state.
      const data = store.getQuads(
        result,
        rdfjsNamedNode(UT_DATA),
        null,
        null,
      )[0];
      if (data) {
        resultFile = `${data.object.value.split("/").pop()}`;
      }
    }
  }

  if (isUpdateEval) {
    const request = action
      ? store.getQuads(action, rdfjsNamedNode(UT_REQUEST), null, null)[0]
      : undefined;
    const dataFiles = action
      ? collectValues(store, action, UT_DATA).map(filePath)
      : [];
    const graphData = action
      ? collectGraphData(store, action, UT_GRAPHDATA, UT_GRAPH)
      : [];
    if (!request) {
      return null;
    }
    return {
      id: `${category}:${localId}`,
      category,
      kind: "update",
      name,
      negativeSyntax,
      queryFile: `${request.object.value.split("/").pop()}`,
      dataFiles,
      graphData,
      resultFile,
    };
  }

  // Query evaluation tests: the action is either a blank node with qt:query /
  // qt:data / qt:graphData, or (for NegativeSyntaxTest11) the query file IRI.
  if (
    action && action.termType === "NamedNode" && action.value.endsWith(".rq")
  ) {
    return {
      id: `${category}:${localId}`,
      category,
      kind: "query",
      name,
      negativeSyntax,
      queryFile: `${action.value.split("/").pop()}`,
      dataFiles: [],
      graphData: [],
      resultFile,
    };
  }
  // Negative-update-syntax entries: the action is a .ru request file directly;
  // both engines must reject it, so it runs through the update path.
  if (
    action && action.termType === "NamedNode" && action.value.endsWith(".ru")
  ) {
    return {
      id: `${category}:${localId}`,
      category,
      kind: "update",
      name,
      negativeSyntax,
      queryFile: `${action.value.split("/").pop()}`,
      dataFiles: [],
      graphData: [],
      resultFile,
    };
  }

  const query = action
    ? store.getQuads(action, rdfjsNamedNode(QT_QUERY), null, null)[0]
    : undefined;
  const dataFiles = action
    ? collectValues(store, action, QT_DATA).map(filePath)
    : [];
  const graphData = action
    ? collectGraphData(store, action, QT_GRAPHDATA, QT_GRAPHDATA)
    : [];
  if (!query) {
    return null;
  }
  return {
    id: `${category}:${localId}`,
    category,
    kind: "query",
    name,
    negativeSyntax,
    queryFile: `${query.object.value.split("/").pop()}`,
    dataFiles,
    graphData,
    resultFile,
  };
}

/**
 * loadManifest parses one category's manifest.ttl and returns its test cases,
 * following any mf:include references (none of the vendored evaluation-core
 * manifests use them today, but the walk keeps the loader robust).
 */
export interface ManifestLoad {
  cases: W3cTestCase[];
  /** skipped counts manifest entries that resolved to no test case. */
  skipped: number;
}

export function loadManifest(
  categoryDir: string,
  manifestText: string,
): ManifestLoad {
  const store = new MemoryStore();
  const parser = new N3Parser();
  const quads: rdfjs.Quad[] = parser.parse(manifestText);
  for (const quad of quads) {
    store.addQuad(quad);
  }

  const cases: W3cTestCase[] = [];
  let skipped = 0;
  const manifestQuads: rdfjs.Quad[] = store.getQuads(
    null,
    rdfjsNamedNode(RDF_TYPE),
    rdfjsNamedNode(MF + "Manifest"),
    null,
  );
  const queue: rdfjs.Term[] = manifestQuads.map((q) => q.subject);

  const seenManifests = new Set<string>();

  while (queue.length > 0) {
    const manifest = queue.shift()!;
    const mkey = manifest.termType + ":" + manifest.value;
    if (seenManifests.has(mkey)) {
      continue;
    }
    seenManifests.add(mkey);

    for (
      const include of store.getQuads(
        manifest,
        rdfjsNamedNode(MF_INCLUDE),
        null,
        null,
      )
    ) {
      if (
        include.object.termType === "BlankNode" ||
        include.object.termType === "NamedNode"
      ) {
        // Includes are other manifest documents; the vendored subset has none,
        // so treat the include list elements as entry-like only when typed.
        queue.push(include.object);
      }
    }
    for (
      const entries of store.getQuads(
        manifest,
        rdfjsNamedNode(MF_ENTRIES),
        null,
        null,
      )
    ) {
      for (const entry of listTerms(store, entries.object)) {
        const action =
          store.getQuads(entry, rdfjsNamedNode(MF_ACTION), null, null)[0];
        const testCase = parseTestCase(
          store,
          categoryDir,
          entry,
          action ? action.object : null,
        );
        if (testCase) {
          cases.push(testCase);
        } else {
          skipped += 1;
        }
      }
    }
  }
  return { cases, skipped };
}

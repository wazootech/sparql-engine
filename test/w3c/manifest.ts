import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Parser as N3Parser, Store as N3Store } from "n3";

const MF = "http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#";
const QT = "http://www.w3.org/2001/sw/DataAccess/tests/test-query#";
const UT = "http://www.w3.org/2009/sparql/tests/test-update#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";

const RDF_TYPE = RDF + "type";
const RDF_FIRST = RDF + "first";
const RDF_REST = RDF + "rest";
const RDF_NIL = RDF + "nil";

const MF_ENTRIES = MF + "entries";
const MF_INCLUDE = MF + "include";
const MF_NAME = MF + "name";
const MF_RESULT = MF + "result";
const MF_ACTION = MF + "action";

const QT_QUERY = QT + "query";
const QT_DATA = QT + "data";
const QT_GRAPHDATA = QT + "graphData";

const UT_REQUEST = UT + "request";
const UT_DATA = UT + "data";
const UT_GRAPHDATA = UT + "graphData";
const UT_GRAPH = UT + "graph";

const TYPE_QUERY_EVAL = MF + "QueryEvaluationTest";
const TYPE_UPDATE_EVAL = MF + "UpdateEvaluationTest";
const TYPE_NEG_SYNTAX = MF + "NegativeSyntaxTest11";
const TYPE_NEG_SYNTAX_LEGACY = MF + "NegativeSyntaxTest";

/**
 * W3cGraphData describes one named-graph data entry: the data file and the
 * graph it loads into. A null graph means the graph is named by the data
 * file's own resolved IRI (per the W3C test framework for unlabeled
 * qt:graphData/ut:graphData entries).
 */
export interface W3cGraphData {
  file: string;
  graph: string | null;
}

/**
 * W3cTestCase is one manifest entry: a query or update evaluation test with
 * its data references, all relative to the fixtures root.
 */
export interface W3cTestCase {
  /** id is `<category>:<manifest local name>` — the allowlist key. */
  id: string;
  category: string;
  kind: "query" | "update";
  name: string;
  /** negativeSyntax marks NegativeSyntaxTest11 entries: both engines must reject. */
  negativeSyntax: boolean;
  /** queryFile / requestFile is the .rq / .ru path relative to the fixtures root. */
  queryFile: string;
  /** dataFiles load into the default graph. */
  dataFiles: string[];
  graphData: W3cGraphData[];
  /** resultFile, when present, is the mf:result file (used for the soft conformance report). */
  resultFile: string | null;
}

/**
 * listTerms walks an RDF list (rdf:first/rdf:rest) collecting its terms.
 */
function listTerms(store: N3Store, head: rdfjs.Term): rdfjs.Term[] {
  const terms: rdfjs.Term[] = [];
  let node = head;
  const seen = new Set<string>();
  while (node.termType !== "NamedNode" || node.value !== RDF_NIL) {
    const key = node.termType + ":" + node.value;
    if (seen.has(key) || node.termType === "Literal") {
      break;
    }
    seen.add(key);
    const first =
      store.getQuads(node, rdfjsNamedNode(RDF_FIRST), null, null)[0];
    if (!first) {
      break;
    }
    terms.push(first.object);
    const rest = store.getQuads(node, rdfjsNamedNode(RDF_REST), null, null)[0];
    if (!rest) {
      break;
    }
    node = rest.object;
  }
  return terms;
}

/**
 * collectValues gathers every object of a property on a subject, expanding
 * RDF-list values into their elements (qt:data ( <a> <b> ) and single-file
 * qt:data <a> both resolve to the file list).
 */
function collectValues(
  store: N3Store,
  subject: rdfjs.Term,
  predicate: string,
): rdfjs.Term[] {
  const values: rdfjs.Term[] = [];
  for (
    const quad of store.getQuads(subject, rdfjsNamedNode(predicate), null, null)
  ) {
    if (
      quad.object.termType === "BlankNode" &&
      store.getQuads(quad.object, rdfjsNamedNode(RDF_FIRST), null, null)
          .length > 0
    ) {
      values.push(...listTerms(store, quad.object));
    } else {
      values.push(quad.object);
    }
  }
  return values;
}

function rdfjsNamedNode(value: string): rdfjs.NamedNode {
  return DataFactory.namedNode(value);
}

/**
 * parseTestCase resolves one manifest entry into a W3cTestCase.
 * All file references resolve against the category's fixtures directory.
 */
function parseTestCase(
  store: N3Store,
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

  // NegativeSyntaxTest11 entries are query-rejection tests and are not typed
  // as mf:QueryEvaluationTest — treat them as query-kind tests.
  if (!isQueryEval && !isUpdateEval && !negativeSyntax) {
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
    if (result.termType === "NamedNode" && result.value.endsWith(".ttl")) {
      resultFile = `${result.value.split("/").pop()}`;
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

function filePath(term: rdfjs.Term): string {
  return term.value.split("/").pop() ?? "";
}

/**
 * collectGraphData gathers graphData entries: each object is either a file
 * IRI (unlabeled → graph named by that file's resolved IRI) or a blank node
 * with a ut:graph file and an rdfs:label graph name.
 */
function collectGraphData(
  store: N3Store,
  subject: rdfjs.Term,
  predicate: string,
  filePredicate: string,
): W3cGraphData[] {
  const entries: W3cGraphData[] = [];
  for (
    const quad of store.getQuads(subject, rdfjsNamedNode(predicate), null, null)
  ) {
    const node = quad.object;
    if (node.termType === "NamedNode") {
      entries.push({ file: filePath(node), graph: null });
      continue;
    }
    const graphQuad =
      store.getQuads(node, rdfjsNamedNode(filePredicate), null, null)[0];
    const labelQuad =
      store.getQuads(node, rdfjsNamedNode(RDFS + "label"), null, null)[0];
    const file = graphQuad ? filePath(graphQuad.object) : null;
    if (file === null) {
      continue;
    }
    entries.push({
      file,
      graph: labelQuad ? labelQuad.object.value : null,
    });
  }
  return entries;
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
  const store = new N3Store();
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

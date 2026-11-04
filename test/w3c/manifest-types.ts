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

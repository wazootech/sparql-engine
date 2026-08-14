import type * as rdfjs from "@rdfjs/types";
// deno-lint-ignore no-import-prefix
import { Parser as N3Parser } from "npm:n3@2.2.0";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import type { SparqlResponse } from "@/sparql-engine-interface.ts";
import { canonicalizeRdfTerm, canonicalizeSparqlValue } from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "../parity/parity-harness.ts";
import { documentedDivergences } from "./divergences.ts";
import type { W3cTestCase } from "./manifest.ts";

/**
 * W3C_BASE is the canonical URL namespace the fixtures resolve against. Both
 * engines parse queries (with a prepended BASE directive) and data (with a
 * base IRI) against these URLs, so relative IRIs like <exists02.ttl> and the
 * empty IRI <> resolve identically in both — reproducing the upstream
 * rdf-test-suite base semantics without any network access.
 */
const W3C_BASE = "http://www.w3.org/2009/sparql/docs/tests/data-sparql11/";

function canonicalUrl(category: string, file: string): string {
  return `${W3C_BASE}${category}/${file}`;
}

/**
 * W3C result-set vocabulary (rs:ResultSet / rs:solution / rs:binding /
 * rs:variable / rs:value), used to parse the reference representation of a
 * SELECT result for documented divergences.
 */
const RS = "http://www.w3.org/2001/sw/DataAccess/tests/result-set#";
const RS_RESULT_SET = RS + "ResultSet";
const RS_SOLUTION = RS + "solution";
const RS_BINDING = RS + "binding";
const RS_VARIABLE = RS + "variable";
const RS_VALUE = RS + "value";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * TestOutcome is the differential verdict for one test.
 */
export type TestOutcome =
  | { status: "pass" }
  | { status: "gap"; detail: string }
  | { status: "error"; detail: string };

/**
 * W3cRunReport aggregates the whole suite run.
 */
export interface W3cRunReport {
  total: number;
  pass: number;
  gap: number;
  error: number;
  skipped: number;
  allowlisted: number;
  /** gapDetails lists every open parity gap, in run order. */
  gapDetails: Array<{ id: string; name: string; detail: string }>;
  errorDetails: Array<{ id: string; name: string; detail: string }>;
  /** conformance is the soft (never gating) spec-expected cross-check. */
  conformance: Array<{
    id: string;
    native: string;
    comunica: string;
  }>;
}

/**
 * bindingRecord renders a binding as a deterministic, sorted string.
 */
function bindingRecord(record: Record<string, CanonicalTerm>): string {
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((name) => [name, record[name]]),
  );
}

function canonicalQuadString(
  item: rdfjs.Quad,
  canonicalize: (term: rdfjs.Term) => CanonicalTerm,
): string {
  return [item.subject, item.predicate, item.object, item.graph]
    .map((term) => JSON.stringify(canonicalize(term)))
    .join(" ");
}

/**
 * dedupeRecords keeps one record per distinct canonical key, pairing each
 * record with the canonical string of the quad it came from. It normalizes
 * a reference-engine CONSTRUCT stream to its graph content: the reference
 * is a set of triples (the W3C reference files are sets), and Comunica's
 * query stream may repeat a triple that its graph would not. Only the
 * reference side is normalized — the native side is compared as-emitted
 * (issue #87 contract, see compareConstructRecords).
 */
export function dedupeRecords(
  records: CanonicalTerm[][],
  keys: string[],
): CanonicalTerm[][] {
  const seen = new Set<string>();
  const out: CanonicalTerm[][] = [];
  for (let i = 0; i < records.length; i++) {
    const key = keys[i];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(records[i]);
    }
  }
  return out;
}

/**
 * multisetEqual compares two arrays as multisets (order-insensitive).
 */
function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const item of a) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  for (const item of b) {
    const remaining = counts.get(item);
    if (remaining === undefined || remaining === 0) {
      return false;
    }
    counts.set(item, remaining - 1);
  }
  return true;
}

/**
 * isomorphicMultiset compares two multisets of records (each record an
 * ordered list of canonical terms) up to blank-node renaming. Blank-node
 * labels are engine-local and unobservable across queries, so two results
 * agree exactly when a consistent relabeling makes them equal.
 */
function isomorphicMultiset(
  a: CanonicalTerm[][],
  b: CanonicalTerm[][],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return multisetEqual(canonicalizeBnodes(a), canonicalizeBnodes(b));
}

/**
 * compareConstructRecords compares a native CONSTRUCT result against a
 * reference (Comunica) result under the graph-result contract (issue #87):
 * the reference side is normalized to its graph content (Comunica's stream
 * may repeat a triple its graph would not), while the native side is
 * compared as-emitted. Decision #29 guarantees a conforming engine emits no
 * duplicate quads — CONSTRUCT collapses duplicate instantiations — so raw
 * native records equal the normalized reference exactly when the graph
 * contents agree, and a future change that starts emitting duplicates fails
 * the gate instead of silently passing.
 */
export function compareConstructRecords(
  nativeRecords: CanonicalTerm[][],
  comunicaRecords: CanonicalTerm[][],
  comunicaKeys: string[],
): boolean {
  return isomorphicMultiset(
    nativeRecords,
    dedupeRecords(comunicaRecords, comunicaKeys),
  );
}

/**
 * canonicalizeBnodes relabels the blank nodes of a record multiset with
 * canonical `_:0, _:1, ...` labels derived from structure by iterative
 * partition refinement (Weisfeiler-Lehman style), so structurally identical
 * results carrying different engine-local labels canonicalize identically.
 */
function canonicalizeBnodes(records: CanonicalTerm[][]): string[] {
  const labels = new Set<string>();
  const visit = (term: CanonicalTerm): void => {
    if (term.termType === "BlankNode") {
      labels.add(term.value);
    } else if (term.termType === "Quad") {
      if (term.subject) visit(term.subject);
      if (term.predicate) visit(term.predicate);
      if (term.object) visit(term.object);
    }
  };
  for (const record of records) {
    for (const term of record) {
      visit(term);
    }
  }

  const renderValue = (
    term: CanonicalTerm,
    map: Map<string, string>,
  ): unknown => {
    if (term.termType === "BlankNode") {
      return { termType: "BlankNode", value: map.get(term.value) ?? "_" };
    }
    if (term.termType === "Quad") {
      return {
        termType: "Quad",
        value: "",
        subject: term.subject ? renderValue(term.subject, map) : undefined,
        predicate: term.predicate
          ? renderValue(term.predicate, map)
          : undefined,
        object: term.object ? renderValue(term.object, map) : undefined,
      };
    }
    return term;
  };
  const render = (term: CanonicalTerm, map: Map<string, string>): string =>
    JSON.stringify(renderValue(term, map));

  const refersTo = (term: CanonicalTerm, label: string): boolean => {
    if (term.termType === "BlankNode") {
      return term.value === label;
    }
    if (term.termType === "Quad") {
      return (term.subject !== undefined && refersTo(term.subject, label)) ||
        (term.predicate !== undefined && refersTo(term.predicate, label)) ||
        (term.object !== undefined && refersTo(term.object, label));
    }
    return false;
  };

  let current = new Map<string, string>();
  for (const label of labels) {
    current.set(label, "s0");
  }
  for (let round = 0; round <= labels.size + 1; round++) {
    const signature = new Map<string, string>();
    for (const label of labels) {
      const contexts: string[] = [];
      for (const record of records) {
        for (let slot = 0; slot < record.length; slot++) {
          if (refersTo(record[slot], label)) {
            const others = record
              .filter((_, index) => index !== slot)
              .map((term) => render(term, current));
            contexts.push(JSON.stringify([slot, ...others]));
          }
        }
      }
      contexts.sort();
      signature.set(label, JSON.stringify(contexts));
    }
    const distinct = [...new Set(signature.values())].sort();
    const idOf = new Map(distinct.map((text, index) => [text, `s${index}`]));
    current = new Map(
      [...labels].map((label) => [label, idOf.get(signature.get(label)!)!]),
    );
  }

  const ordered = [...labels].sort((a, b) => {
    const aId = current.get(a)!;
    const bId = current.get(b)!;
    if (aId !== bId) {
      return aId < bId ? -1 : 1;
    }
    return a < b ? -1 : 1;
  });
  const canonical = new Map<string, string>();
  ordered.forEach((label, index) => canonical.set(label, `_:${index}`));

  return records.map((record) =>
    record.map((term) => render(term, canonical)).join("\u0000")
  );
}

/**
 * W3cRunner executes the W3C evaluation-core tests differentially.
 */
export class W3cRunner {
  private readonly comunicaEngine = getComunicaEngine();
  private readonly report: W3cRunReport = {
    total: 0,
    pass: 0,
    gap: 0,
    error: 0,
    skipped: 0,
    allowlisted: 0,
    gapDetails: [],
    errorDetails: [],
    conformance: [],
  };

  public constructor(
    private readonly readFixture: (file: string) => string,
  ) {}

  /**
   * run executes every test case and returns the aggregate report.
   */
  public async run(cases: W3cTestCase[]): Promise<W3cRunReport> {
    for (const testCase of cases) {
      await this.runOne(testCase);
    }
    return this.report;
  }

  private async runOne(testCase: W3cTestCase): Promise<void> {
    this.report.total += 1;
    const divergence = testCase.id in documentedDivergences;

    let outcome: TestOutcome;
    try {
      if (divergence) {
        // Documented divergences are validated against the W3C reference
        // result, not against Comunica (which is known to be buggy there).
        outcome = await this.compareReference(testCase);
      } else {
        outcome = testCase.kind === "update"
          ? await this.compareUpdate(testCase)
          : await this.compareQuery(testCase);
      }
    } catch (error) {
      outcome = {
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.status === "pass") {
      this.report.pass += 1;
    } else if (outcome.status === "gap") {
      this.report.gap += 1;
      this.report.gapDetails.push({
        id: testCase.id,
        name: testCase.name,
        detail: outcome.detail,
      });
    } else {
      this.report.error += 1;
      this.report.errorDetails.push({
        id: testCase.id,
        name: testCase.name,
        detail: outcome.detail,
      });
    }

    const conformance = await this.conformanceReport(testCase);
    if (conformance) {
      this.report.conformance.push(conformance);
    }
  }

  private fixtureText(testCase: W3cTestCase, file: string): string {
    return this.readFixture(`${testCase.category}/${file}`);
  }

  /**
   * loadStore seeds a fresh MemoryStore for a test case: data files into the
   * default graph, graphData into named graphs (named by the label IRI or,
   * when unlabeled, by the data file's own resolved IRI).
   */
  private loadStore(testCase: W3cTestCase): MemoryStore {
    const store = new MemoryStore();
    const load = (file: string, graph: string | null): void => {
      const text = this.fixtureText(testCase, file);
      const parser = new N3Parser({
        baseIRI: canonicalUrl(testCase.category, file),
      });
      const quads: rdfjs.Quad[] = parser.parse(text);
      for (const quad of quads) {
        if (graph === null) {
          store.addQuad(quad);
        } else {
          store.addQuad(
            quad.subject,
            quad.predicate,
            quad.object,
            DataFactory.namedNode(graph),
          );
        }
      }
    };
    for (const file of testCase.dataFiles) {
      load(file, null);
    }
    for (const entry of testCase.graphData) {
      load(
        entry.file,
        entry.graph ?? canonicalUrl(testCase.category, entry.file),
      );
    }
    return store;
  }

  /**
   * queryText prepends a BASE directive so relative IRIs resolve against the
   * query file's canonical URL in both engines.
   */
  private queryText(testCase: W3cTestCase): string {
    const raw = this.fixtureText(testCase, testCase.queryFile);
    return `BASE <${
      canonicalUrl(testCase.category, testCase.queryFile)
    }>\n${raw}`;
  }

  /**
   * comunicaRunsQuery reports whether Comunica accepts and executes the
   * query (throwing nothing), for one-sided-rejection detection.
   */
  private async comunicaRunsQuery(
    testCase: W3cTestCase,
    query: string,
  ): Promise<boolean> {
    try {
      const store = this.loadStore(testCase);
      const stream = await this.comunicaEngine.queryBindings(query, {
        sources: [store],
      });
      await stream.toArray();
      return true;
    } catch {
      return false;
    }
  }

  private async comunicaRunsUpdate(
    testCase: W3cTestCase,
    request: string,
  ): Promise<boolean> {
    try {
      await this.comunicaEngine.queryVoid(request, {
        sources: [this.loadStore(testCase)],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * compareReference validates a documented divergence against the W3C
   * reference result instead of Comunica, so a spec-correct native result
   * passes even when Comunica lite is buggy. SELECT divergences compare
   * against the rs:ResultSet reference up to blank-node isomorphism; update
   * divergences with an empty mf:result compare the final store against an
   * empty store.
   */
  private compareReference(testCase: W3cTestCase): Promise<TestOutcome> {
    return testCase.kind === "update"
      ? this.compareUpdateReference(testCase)
      : this.compareQueryReference(testCase);
  }

  private async compareQueryReference(
    testCase: W3cTestCase,
  ): Promise<TestOutcome> {
    if (!testCase.resultFile) {
      return {
        status: "error",
        detail:
          `documented SELECT divergence ${testCase.id} has no result file`,
      };
    }

    const store = this.loadStore(testCase);
    const native = new WazooSparqlEngine({ store });
    const nativeResult = await native.execute({
      query: this.queryText(testCase),
    });
    if (nativeResult.kind !== "select") {
      return {
        status: "error",
        detail:
          `documented divergence ${testCase.id} returned kind ${nativeResult.kind}, expected select`,
      };
    }

    const solutions = this.parseResultSetTtl(testCase, testCase.resultFile);
    const nativeRecords = this.nativeSelectRecords(nativeResult);
    const referenceRecords = this.resultSetRecords(solutions);
    if (isomorphicMultiset(nativeRecords, referenceRecords)) {
      return { status: "pass" };
    }
    return {
      status: "gap",
      detail: this.firstDiff(
        this.nativeSelectStrings(nativeResult),
        this.resultSetStrings(solutions),
        "native vs W3C reference bindings",
      ),
    };
  }

  private async compareUpdateReference(
    testCase: W3cTestCase,
  ): Promise<TestOutcome> {
    const nativeStore = this.loadStore(testCase);
    const native = new WazooSparqlEngine({ store: nativeStore });
    try {
      const result = await native.execute({ query: this.queryText(testCase) });
      if (result.kind !== "void") {
        return {
          status: "error",
          detail: `native update ${testCase.id} returned a non-void result`,
        };
      }
    } catch (error) {
      return {
        status: "error",
        detail: `native rejected the update for divergence ${testCase.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const quads: rdfjs.Quad[] = nativeStore.getQuads(null, null, null, null);
    if (quads.length === 0) {
      return { status: "pass" };
    }
    return {
      status: "gap",
      detail:
        `native left ${quads.length} quad(s) after ${testCase.id}; the W3C reference (mf:result []) expects an empty store`,
    };
  }

  /**
   * parseResultSetTtl parses an rs:ResultSet result file into canonical
   * binding records — the W3C reference representation of a SELECT result.
   * Each record maps variable name -> canonical term, matching the shape
   * nativeSelectRecords and runComunicaSelectRecords build from live results.
   */
  private parseResultSetTtl(
    testCase: W3cTestCase,
    file: string,
  ): Record<string, CanonicalTerm>[] {
    const parser = new N3Parser({
      baseIRI: canonicalUrl(testCase.category, file),
    });
    const quads: rdfjs.Quad[] = parser.parse(this.fixtureText(testCase, file));
    const store = new MemoryStore();
    for (const quad of quads) {
      store.addQuad(quad);
    }

    const resultSetQuad = store.getQuads(
      null,
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(RS_RESULT_SET),
      null,
    )[0];
    if (!resultSetQuad) {
      throw new Error(`result file is not an rs:ResultSet: ${file}`);
    }
    const resultSet = resultSetQuad.subject;

    const solutions: Record<string, CanonicalTerm>[] = [];
    for (
      const solutionQuad of store.getQuads(
        resultSet,
        DataFactory.namedNode(RS_SOLUTION),
        null,
        null,
      )
    ) {
      const record: Record<string, CanonicalTerm> = {};
      for (
        const bindingQuad of store.getQuads(
          solutionQuad.object,
          DataFactory.namedNode(RS_BINDING),
          null,
          null,
        )
      ) {
        const variable = store.getQuads(
          bindingQuad.object,
          DataFactory.namedNode(RS_VARIABLE),
          null,
          null,
        )[0];
        const value = store.getQuads(
          bindingQuad.object,
          DataFactory.namedNode(RS_VALUE),
          null,
          null,
        )[0];
        if (!variable || !value) {
          continue;
        }
        record[variable.object.value] = canonicalizeRdfTerm(value.object);
      }
      solutions.push(record);
    }
    return solutions;
  }

  private resultSetRecords(
    solutions: Record<string, CanonicalTerm>[],
  ): CanonicalTerm[][] {
    return solutions.map((record) =>
      Object.keys(record).sort().map((name) => record[name])
    );
  }

  private resultSetStrings(
    solutions: Record<string, CanonicalTerm>[],
  ): string[] {
    return solutions.map(bindingRecord);
  }

  private async compareQuery(testCase: W3cTestCase): Promise<TestOutcome> {
    const query = this.queryText(testCase);

    let nativeResult: SparqlResponse;
    try {
      const store = this.loadStore(testCase);
      const native = new WazooSparqlEngine({ store });
      nativeResult = await native.execute({ query });
    } catch (error) {
      // Native rejected the query. Differential contract: pass only if
      // Comunica rejects it too (both-reject agreement, which is the
      // expected outcome for NegativeSyntaxTest11 entries).
      const comunicaAccepted = await this.comunicaRunsQuery(testCase, query);
      if (!comunicaAccepted) {
        return { status: "pass" };
      }
      return {
        status: "gap",
        detail: `native rejected the query, comunica accepted it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const comunicaOutcome = await this.runComunicaQuery(testCase, nativeResult);
    return comunicaOutcome;
  }

  private async runComunicaQuery(
    testCase: W3cTestCase,
    nativeResult: SparqlResponse,
  ): Promise<TestOutcome> {
    const store = this.loadStore(testCase);
    const query = this.queryText(testCase);
    const options = { sources: [store] };

    switch (nativeResult.kind) {
      case "select": {
        let comunica: string[];
        try {
          comunica = await this.runComunicaSelect(query, store);
        } catch (error) {
          return {
            status: "gap",
            detail: `native executed the query, comunica rejected it: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        const native = this.nativeSelectStrings(nativeResult);
        const nativeRecords = this.nativeSelectRecords(nativeResult);
        const comunicaRecords = await this.runComunicaSelectRecords(
          query,
          store,
        );
        return isomorphicMultiset(nativeRecords, comunicaRecords)
          ? { status: "pass" }
          : {
            status: "gap",
            detail: this.firstDiff(native, comunica, "SELECT bindings"),
          };
      }
      case "ask": {
        let comunica: boolean;
        try {
          comunica = await this.comunicaEngine.queryBoolean(query, options);
        } catch (error) {
          return {
            status: "gap",
            detail: `native executed the query, comunica rejected it: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        return comunica === nativeResult.data.boolean ? { status: "pass" } : {
          status: "gap",
          detail:
            `ASK mismatch: comunica=${comunica} native=${nativeResult.data.boolean}`,
        };
      }
      case "construct": {
        let comunicaSet: string[];
        let comunicaRecords: CanonicalTerm[][];
        let comunicaKeys: string[];
        try {
          const stream = await this.comunicaEngine.queryQuads(query, options);
          const comunicaQuads = await stream.toArray();
          comunicaKeys = comunicaQuads.map((item) =>
            canonicalQuadString(item, canonicalizeComunicaTerm)
          );
          comunicaSet = [...comunicaKeys].sort();
          comunicaRecords = comunicaQuads.map((item) =>
            this.quadRecords(item, canonicalizeComunicaTerm)
          );
        } catch (error) {
          return {
            status: "gap",
            detail: `native executed the query, comunica rejected it: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        const nativeKeys = nativeResult.data.quads.map((item) =>
          canonicalQuadString(item, canonicalizeRdfTerm)
        );
        const nativeSet = [...nativeKeys].sort();
        // Issue #87 contract: the reference side is normalized to its graph
        // content, while the native side is compared as-emitted — decision
        // #29 guarantees a conforming engine emits no duplicate quads, so a
        // future change that starts emitting them fails this gate.
        const nativeRecords = nativeResult.data.quads.map((item) =>
          this.quadRecords(item, canonicalizeRdfTerm)
        );
        return compareConstructRecords(
            nativeRecords,
            comunicaRecords,
            comunicaKeys,
          )
          ? { status: "pass" }
          : {
            status: "gap",
            detail: this.firstDiff(nativeSet, comunicaSet, "CONSTRUCT quads"),
          };
      }
      default:
        return {
          status: "error",
          detail: `native returned unexpected kind ${nativeResult.kind}`,
        };
    }
  }

  private nativeSelectStrings(nativeResult: SparqlResponse): string[] {
    if (nativeResult.kind !== "select") {
      return [];
    }
    return nativeResult.data.results.bindings.map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return bindingRecord(record);
    });
  }

  private nativeSelectRecords(nativeResult: SparqlResponse): CanonicalTerm[][] {
    if (nativeResult.kind !== "select") {
      return [];
    }
    return nativeResult.data.results.bindings.map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return Object.keys(record).sort().map((name) => record[name]);
    });
  }

  private async runComunicaSelect(
    query: string,
    store: MemoryStore,
  ): Promise<string[]> {
    const raw = await runComunicaRawSelectBindings(
      this.comunicaEngine,
      query,
      store,
    );
    return raw.map((record) => {
      const canonical: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(record)) {
        canonical[name] = canonicalizeComunicaTerm(record[name]);
      }
      return bindingRecord(canonical);
    });
  }

  private async runComunicaSelectRecords(
    query: string,
    store: MemoryStore,
  ): Promise<CanonicalTerm[][]> {
    const raw = await runComunicaRawSelectBindings(
      this.comunicaEngine,
      query,
      store,
    );
    return raw.map((record) => {
      const canonical: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(record)) {
        canonical[name] = canonicalizeComunicaTerm(record[name]);
      }
      return Object.keys(canonical).sort().map((name) => canonical[name]);
    });
  }

  private quadRecords(
    item: rdfjs.Quad,
    canonicalize: (term: rdfjs.Term) => CanonicalTerm,
  ): CanonicalTerm[] {
    return [item.subject, item.predicate, item.object, item.graph]
      .map((term) => canonicalize(term));
  }

  private firstDiff(a: string[], b: string[], label: string): string {
    const aSet = [...a].sort();
    const bSet = [...b].sort();
    for (let index = 0; index < Math.max(aSet.length, bSet.length); index++) {
      if (aSet[index] !== bSet[index]) {
        return (
          `${label} diverge (native ${aSet.length}, comunica ${bSet.length}):\n` +
          `  native:   ${aSet[index] ?? "<absent>"}\n` +
          `  comunica: ${bSet[index] ?? "<absent>"}`
        );
      }
    }
    return `${label} differ in count or order`;
  }

  private async compareUpdate(testCase: W3cTestCase): Promise<TestOutcome> {
    const request = this.queryText(testCase);

    const nativeStore = this.loadStore(testCase);
    const native = new WazooSparqlEngine({ store: nativeStore });
    try {
      const result = await native.execute({ query: request });
      if (result.kind !== "void") {
        return {
          status: "error",
          detail: "native update returned a non-void result",
        };
      }
    } catch (error) {
      const comunicaAccepted = await this.comunicaRunsUpdate(testCase, request);
      if (!comunicaAccepted) {
        return { status: "pass" };
      }
      return {
        status: "gap",
        detail: `native rejected the update, comunica accepted it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const comunicaStore = this.loadStore(testCase);
    try {
      await this.comunicaEngine.queryVoid(request, {
        sources: [comunicaStore],
      });
    } catch (error) {
      return {
        status: "gap",
        detail: `native executed the update, comunica rejected it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const nativeSet = this.storeQuadStrings(nativeStore).sort();
    const comunicaSet = this.storeQuadStrings(comunicaStore).sort();
    const nativeRecords = this.storeQuadRecords(nativeStore);
    const comunicaRecords = this.storeQuadRecords(comunicaStore);
    return isomorphicMultiset(nativeRecords, comunicaRecords)
      ? { status: "pass" }
      : {
        status: "gap",
        detail: this.firstDiff(nativeSet, comunicaSet, "final store contents"),
      };
  }

  private storeQuadStrings(store: MemoryStore): string[] {
    const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
    return quads.map((item) => canonicalQuadString(item, canonicalizeRdfTerm));
  }

  private storeQuadRecords(store: MemoryStore): CanonicalTerm[][] {
    const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
    return quads.map((item) => this.quadRecords(item, canonicalizeRdfTerm));
  }

  /**
   * conformanceReport soft-checks the spec-expected result where it is
   * parseable: update post-states and CONSTRUCT result files are TTL (parsed
   * with n3); SELECT and ASK results are SPARQL XML/JSON, which this runner
   * does not parse. The report never gates — it only adds signal about which
   * engine is right when the two disagree.
   */
  private async conformanceReport(
    testCase: W3cTestCase,
  ): Promise<W3cRunReport["conformance"][number] | null> {
    if (!testCase.resultFile) {
      return null;
    }
    let expectedRecords: CanonicalTerm[][];
    try {
      const parser = new N3Parser({
        baseIRI: canonicalUrl(testCase.category, testCase.resultFile),
      });
      const expectedQuads: rdfjs.Quad[] = parser.parse(
        this.fixtureText(testCase, testCase.resultFile),
      );
      // rs:ResultSet files are SELECT references, not graph post-states;
      // compareReference validates those tests, so skip the soft report.
      if (
        expectedQuads.some((quad) =>
          quad.predicate.termType === "NamedNode" &&
          quad.predicate.value === RDF_TYPE &&
          quad.object.termType === "NamedNode" &&
          quad.object.value === RS_RESULT_SET
        )
      ) {
        return null;
      }
      expectedRecords = expectedQuads.map((quad) =>
        this.quadRecords(quad, canonicalizeRdfTerm)
      );
    } catch {
      return null; // XML/JSON result files are not parseable here.
    }

    const evaluate = async (
      engine: "native" | "comunica",
    ): Promise<boolean> => {
      try {
        const store = this.loadStore(testCase);
        let actualQuads: rdfjs.Quad[] = [];
        if (engine === "native") {
          const res = await new WazooSparqlEngine({ store }).execute({
            query: this.queryText(testCase),
          });
          if (res.kind === "construct") {
            actualQuads = res.data.quads;
          } else if (res.kind === "void") {
            actualQuads = store.getQuads(
              null,
              null,
              null,
              DataFactory.defaultGraph(),
            );
          }
        } else {
          if (testCase.kind === "update") {
            await this.comunicaEngine.queryVoid(this.queryText(testCase), {
              sources: [store],
            });
            actualQuads = store.getQuads(
              null,
              null,
              null,
              DataFactory.defaultGraph(),
            );
          } else {
            const stream = await this.comunicaEngine.queryQuads(
              this.queryText(testCase),
              { sources: [store] },
            );
            actualQuads = await stream.toArray();
          }
        }
        const actualRecords = actualQuads.map((quad) =>
          this.quadRecords(quad, canonicalizeRdfTerm)
        );
        return isomorphicMultiset(actualRecords, expectedRecords);
      } catch {
        return false;
      }
    };

    const native = await evaluate("native");
    const comunica = await evaluate("comunica");
    return {
      id: testCase.id,
      native: native ? "conforms" : "deviates",
      comunica: comunica ? "conforms" : "deviates",
    };
  }
}

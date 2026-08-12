import type * as rdfjs from "@rdfjs/types";
import { DataFactory, Parser as N3Parser, Store as N3Store } from "n3";
import { NativeSparqlEngine } from "@/native-sparql-engine.ts";
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
 * engines parse queries (with a prepended BASE directive) and data (N3
 * baseIRI) against these URLs, so relative IRIs like <exists02.ttl> and the
 * empty IRI <> resolve identically in both — reproducing the upstream
 * rdf-test-suite base semantics without any network access.
 */
const W3C_BASE = "http://www.w3.org/2009/sparql/docs/tests/data-sparql11/";

function canonicalUrl(category: string, file: string): string {
  return `${W3C_BASE}${category}/${file}`;
}

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
    const allowlisted = testCase.id in documentedDivergences;

    let outcome: TestOutcome;
    try {
      outcome = testCase.kind === "update"
        ? await this.compareUpdate(testCase)
        : await this.compareQuery(testCase);
    } catch (error) {
      outcome = {
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.status === "pass") {
      this.report.pass += 1;
    } else if (outcome.status === "gap") {
      if (allowlisted) {
        this.report.allowlisted += 1;
      } else {
        this.report.gap += 1;
        this.report.gapDetails.push({
          id: testCase.id,
          name: testCase.name,
          detail: outcome.detail,
        });
      }
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
   * loadStore seeds a fresh N3 store for a test case: data files into the
   * default graph, graphData into named graphs (named by the label IRI or,
   * when unlabeled, by the data file's own resolved IRI).
   */
  private loadStore(testCase: W3cTestCase): N3Store {
    const store = new N3Store();
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

  private async compareQuery(testCase: W3cTestCase): Promise<TestOutcome> {
    const query = this.queryText(testCase);

    let nativeResult: SparqlResponse;
    try {
      const store = this.loadStore(testCase);
      const native = new NativeSparqlEngine({ store });
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
        return multisetEqual(comunica, native) ? { status: "pass" } : {
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
        try {
          const stream = await this.comunicaEngine.queryQuads(query, options);
          comunicaSet = (await stream.toArray())
            .map((item) => canonicalQuadString(item, canonicalizeComunicaTerm))
            .sort();
        } catch (error) {
          return {
            status: "gap",
            detail: `native executed the query, comunica rejected it: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
        const nativeSet = nativeResult.data.quads
          .map((item) => canonicalQuadString(item, canonicalizeRdfTerm))
          .sort();
        return multisetEqual(comunicaSet, nativeSet) ? { status: "pass" } : {
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

  private async runComunicaSelect(
    query: string,
    store: N3Store,
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
    const native = new NativeSparqlEngine({ store: nativeStore });
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
    return multisetEqual(nativeSet, comunicaSet) ? { status: "pass" } : {
      status: "gap",
      detail: this.firstDiff(nativeSet, comunicaSet, "final store contents"),
    };
  }

  private storeQuadStrings(store: N3Store): string[] {
    const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
    return quads.map((item) => canonicalQuadString(item, canonicalizeRdfTerm));
  }

  /**
   * conformanceReport soft-checks the spec-expected result where it is
   * parseable: update post-states and CONSTRUCT result files are TTL (parsed
   * with N3); SELECT and ASK results are SPARQL XML/JSON, which this runner
   * does not parse. The report never gates — it only adds signal about which
   * engine is right when the two disagree.
   */
  private async conformanceReport(
    testCase: W3cTestCase,
  ): Promise<W3cRunReport["conformance"][number] | null> {
    if (!testCase.resultFile) {
      return null;
    }
    let expected: string[];
    try {
      const parser = new N3Parser({
        baseIRI: canonicalUrl(testCase.category, testCase.resultFile),
      });
      const expectedQuads: rdfjs.Quad[] = parser.parse(
        this.fixtureText(testCase, testCase.resultFile),
      );
      expected = expectedQuads
        .map((quad) => canonicalQuadString(quad, canonicalizeRdfTerm))
        .sort();
    } catch {
      return null; // XML/JSON result files are not parseable here.
    }

    const evaluate = async (
      engine: "native" | "comunica",
    ): Promise<boolean> => {
      try {
        const store = this.loadStore(testCase);
        if (engine === "native") {
          await new NativeSparqlEngine({ store }).execute({
            query: this.queryText(testCase),
          });
        } else {
          if (testCase.kind === "update") {
            await this.comunicaEngine.queryVoid(this.queryText(testCase), {
              sources: [store],
            });
          } else {
            const stream = await this.comunicaEngine.queryBindings(
              this.queryText(testCase),
              { sources: [store] },
            );
            await stream.toArray();
          }
        }
        const actual = this.storeQuadStrings(store).sort();
        return multisetEqual(actual, expected);
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

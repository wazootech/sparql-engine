import type * as rdfjs from "@rdfjs/types";
import { assertEquals } from "@std/assert";
import { DataFactory } from "@/term/mod.ts";
import { MemoryStore as Store } from "@/store/memory-store.ts";
import {
  blankNode as oxigraphBlankNode,
  defaultGraph as oxigraphDefaultGraph,
  literal as oxigraphLiteral,
  namedNode as oxigraphNamedNode,
  quad as oxigraphQuad,
  Store as OxigraphStore,
} from "oxigraph";
import { WazooSparqlEngine } from "@/wazoo-sparql-engine.ts";
import {
  canonicalizeComunicaTerm,
  getComunicaEngine,
  runComunicaRawSelectBindings,
} from "../test/parity/parity-harness.ts";
import {
  canonicalizeRdfTerm,
  canonicalizeSparqlValue,
  XSD_INTEGER,
} from "@/term/mod.ts";
import type { CanonicalTerm } from "@/term/mod.ts";

const { blankNode, literal, namedNode, quad } = DataFactory;

const PERSON_COUNT = 400;
const LARGE_PERSON_COUNT = 10_000;
const foafName = namedNode("http://xmlns.com/foaf/0.1/name");
const foafKnows = namedNode("http://xmlns.com/foaf/0.1/knows");
const foafAge = namedNode("http://xmlns.com/foaf/0.1/age");
const examplePet = namedNode("http://example.org/pet");
const xsdInteger = namedNode(XSD_INTEGER);
const examplePerson = (index: number) =>
  namedNode(`http://example.org/person${index}`);
const exCity = namedNode("http://example.org/city");
const exSpouse = namedNode("http://example.org/spouse");
const exG1Prop = namedNode("http://example.org/g1prop");
const g1Graph = namedNode("http://example.org/g1");
const g2Graph = namedNode("http://example.org/g2");

/**
 * buildPeopleDataset generates a ring of people, each with a name, an integer
 * age, a blank node pet, a knows edge, a city tag (5 distinct values), and a
 * spouse edge on even-indexed people only. The 400-person shared benchmark
 * graph and the 10k-subject scaling graph are the same shape at different
 * sizes, so EXISTS rows compare like for like.
 */
function buildPeopleDataset(count: number): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < count; index++) {
    const person = examplePerson(index);
    quads.push(quad(person, foafName, literal(`Person ${index}`)));
    quads.push(
      quad(
        person,
        foafAge,
        literal(`${20 + (index % 50)}`, xsdInteger),
      ),
    );
    quads.push(quad(person, examplePet, blankNode(`pet-${index}`)));
    quads.push(
      quad(
        person,
        foafKnows,
        examplePerson((index + 1) % count),
      ),
    );
    // City tag (5 distinct values) — grouping/filter/distinct material.
    quads.push(quad(person, exCity, literal(`City ${index % 5}`)));
    // Spouse edge on even-indexed people only — OPTIONAL/MINUS null material.
    if (index % 2 === 0) {
      quads.push(quad(person, exSpouse, examplePerson(index + 1)));
    }
  }
  return quads;
}

/**
 * buildDataset generates the shared 400-person benchmark graph.
 */
function buildDataset(): rdfjs.Quad[] {
  return buildPeopleDataset(PERSON_COUNT);
}

/**
 * buildGraphDataset generates the named-graph benchmark data: person quads in
 * graph <http://example.org/g1>. Kept separate from the main dataset so the
 * update verification (which dumps stores graph-blind) stays symmetric.
 */
function buildGraphDataset(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < 200; index++) {
    quads.push(
      quad(
        examplePerson(index),
        exG1Prop,
        literal(`v${index % 10}`),
        g1Graph,
      ),
    );
  }
  return quads;
}

/**
 * buildGraphOpsDataset seeds the named-graph update benchmark: graph g1 as
 * the source (200 quads) and graph g2 as a pre-seeded destination (50 quads),
 * so ADD / COPY / MOVE / CLEAR / DROP produce distinct, observable store
 * states rather than trivial ones.
 */
function buildGraphOpsDataset(): rdfjs.Quad[] {
  const quads: rdfjs.Quad[] = [];
  for (let index = 0; index < 200; index++) {
    quads.push(
      quad(examplePerson(index), exG1Prop, literal(`v${index % 10}`), g1Graph),
    );
  }
  for (let index = 0; index < 50; index++) {
    quads.push(
      quad(examplePerson(index), exG1Prop, literal(`w${index}`), g2Graph),
    );
  }
  return quads;
}

/**
 * toOxigraphTerm maps an RDF/JS term to its Oxigraph equivalent.
 */
function toOxigraphTerm(term: rdfjs.Term): unknown {
  switch (term.termType) {
    case "NamedNode":
      return oxigraphNamedNode(term.value);
    case "BlankNode":
      return oxigraphBlankNode(term.value);
    case "Literal":
      if (term.language) {
        return oxigraphLiteral(term.value, term.language);
      }
      if (term.datatype) {
        return oxigraphLiteral(
          term.value,
          oxigraphNamedNode(term.datatype.value),
        );
      }
      return oxigraphLiteral(term.value);
    case "DefaultGraph":
      return oxigraphDefaultGraph();
    default:
      throw new Error(`Unsupported RDF term type: ${term.termType}`);
  }
}

/**
 * toOxigraphQuad maps an RDF/JS quad to its Oxigraph equivalent.
 */
function toOxigraphQuad(item: rdfjs.Quad): ReturnType<typeof oxigraphQuad> {
  return oxigraphQuad(
    toOxigraphTerm(item.subject) as Parameters<typeof oxigraphQuad>[0],
    toOxigraphTerm(item.predicate) as Parameters<typeof oxigraphQuad>[1],
    toOxigraphTerm(item.object) as Parameters<typeof oxigraphQuad>[2],
    toOxigraphTerm(item.graph) as Parameters<typeof oxigraphQuad>[3],
  );
}

/**
 * seedStore builds a fresh memory store seeded with the given quads.
 */
function seedStore(quads: rdfjs.Quad[]): Store {
  const store = new Store();
  for (const item of quads) {
    store.addQuad(item);
  }
  return store;
}

/**
 * seedOxigraphStore builds a fresh Oxigraph Store seeded with the given
 * quads (converted to Oxigraph terms).
 */
function seedOxigraphStore(quads: rdfjs.Quad[]): OxigraphStore {
  const store = new OxigraphStore();
  for (const item of quads) {
    store.add(toOxigraphQuad(item));
  }
  return store;
}

const dataset = buildDataset();
const memoryStore = seedStore(dataset);
const oxigraphStore = seedOxigraphStore(dataset);

const wazooEngine = new WazooSparqlEngine({ store: memoryStore });
const wazooEngineNoReorder = new WazooSparqlEngine({
  store: memoryStore,
  reorderPatterns: false,
});
const comunicaEngine = getComunicaEngine();

// 10k-subject scaling group: the same person-ring shape at 25x the main
// dataset, to validate that EXISTS probe cost stays proportional to the
// candidate bucket rather than the dataset size.
const largeDataset = buildPeopleDataset(LARGE_PERSON_COUNT);
const largeMemoryStore = seedStore(largeDataset);
const largeOxigraphStore = seedOxigraphStore(largeDataset);
const largeWazooEngine = new WazooSparqlEngine({ store: largeMemoryStore });

// GRAPH / FROM groups run against their own named-graph stores; the update
// verification keeps the main dataset default-graph-only so its graph-blind
// store dump stays symmetric across engines.
const graphDataset = buildGraphDataset();
const graphMemoryStore = seedStore(graphDataset);
const graphOxigraphStore = seedOxigraphStore(graphDataset);
const graphWazooEngine = new WazooSparqlEngine({ store: graphMemoryStore });
const graphOpsDataset = buildGraphOpsDataset();

const scanQuery = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
const joinQuery =
  "SELECT ?friend ?name WHERE { ?person <http://xmlns.com/foaf/0.1/knows> ?friend . " +
  "?friend <http://xmlns.com/foaf/0.1/name> ?name }";
// Written order is worst-case for the wazoo engine: the unselective pattern
// (0 constants, matches all 1,600 quads) comes first, followed by a very
// selective pattern (2 constants, 1 quad). Static reordering flips them.
const asymJoinQuery = "SELECT ?s ?p ?o ?n WHERE { ?s ?p ?o . " +
  "<http://example.org/person0> <http://xmlns.com/foaf/0.1/name> ?n }";
const askQuery =
  "ASK WHERE { <http://example.org/person0> <http://xmlns.com/foaf/0.1/name> ?name }";
// Join chain written in worst-case order for a static planner: all three
// patterns have one constant, so a constant-count heuristic keeps the
// written order and joins ?grand <name> ?n before ?friend binds ?grand,
// forcing a 400x400 intermediate. Dynamic reordering sees that the name
// pattern's variable stays unbound and instead joins the knows patterns
// first, collapsing the intermediate to 400.
const chainQuery =
  "SELECT ?s ?grand ?n WHERE { ?s <http://xmlns.com/foaf/0.1/knows> ?friend . " +
  "?grand <http://xmlns.com/foaf/0.1/name> ?n . " +
  "?friend <http://xmlns.com/foaf/0.1/knows> ?grand }";
// Mutating update: moves every name quad to a new predicate. Used for the
// cross-engine verification, which runs on fresh throwaway stores so a
// broken engine that silently ignores updates is caught (its store would
// still contain name quads, not displayName quads).
const moveUpdateQuery =
  "DELETE { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "INSERT { ?person <http://example.org/displayName> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";
// Self-restoring update: deletes every name quad and re-inserts it, netting
// to zero per iteration, so the persistent benchmark stores never drift and
// every bench iteration times the same work (WHERE evaluation, matching,
// deletes, inserts).
const rewriteUpdateQuery =
  "DELETE { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "INSERT { ?person <http://xmlns.com/foaf/0.1/name> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";
const constructQuery =
  "CONSTRUCT { ?person <http://example.org/displayName> ?name } " +
  "WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name }";

// Feature groups: OPTIONAL / MINUS / UNION, property paths, GROUP BY +
// aggregates, expression FILTERs, ORDER BY + slice, DISTINCT, VALUES + BIND,
// GRAPH, FROM, plus the 100%-era surface defined further down (subqueries,
// EXISTS/NOT EXISTS, XSD casts, string functions, HAVING, CONSTRUCT lists,
// REDUCED, and the remaining update ops). Each group verifies all three
// engines agree on the result *before* timings are taken.
const optionalQuery =
  "SELECT ?person ?spouse WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name " +
  "OPTIONAL { ?person <http://example.org/spouse> ?spouse } }";
const minusQuery =
  "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/name> ?name " +
  "MINUS { ?person <http://example.org/spouse> ?s } }";
const unionQuery =
  "SELECT ?s WHERE { { ?s <http://xmlns.com/foaf/0.1/name> ?n } " +
  "UNION { ?s <http://example.org/pet> ?p } }";
// 10k join-scaling queries: each joins a large accumulated binding set
// against a large right side on the shared subject variable, so the rows
// measure the join machinery (hash join for the wazoo engine) rather than
// the element evaluation. UNION joins 10k x 20k (~200M candidate pairs),
// OPTIONAL and MINUS join 10k x 5k (~50M pairs).
const unionJoinQuery =
  "SELECT ?s ?a ?n WHERE { ?s <http://xmlns.com/foaf/0.1/age> ?a . " +
  "{ ?s <http://xmlns.com/foaf/0.1/name> ?n } " +
  "UNION { ?s <http://example.org/city> ?c } }";
const optionalJoinQuery =
  "SELECT ?s ?n ?sp WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n . " +
  "OPTIONAL { ?s <http://example.org/spouse> ?sp } }";
const minusJoinQuery =
  "SELECT ?s ?n WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n . " +
  "MINUS { ?s <http://example.org/spouse> ?sp } }";
const pathSeqQuery =
  "SELECT ?person ?grand WHERE { ?person <http://xmlns.com/foaf/0.1/knows>/" +
  "<http://xmlns.com/foaf/0.1/knows> ?grand }";
const pathPlusQuery =
  "SELECT ?person WHERE { ?person <http://xmlns.com/foaf/0.1/knows>+ " +
  "<http://example.org/person100> }";
const groupAggQuery =
  "SELECT ?city (COUNT(*) AS ?cnt) (MAX(?age) AS ?maxAge) WHERE { " +
  "?s <http://example.org/city> ?city ; <http://xmlns.com/foaf/0.1/age> ?age } " +
  "GROUP BY ?city";
const filterExprQuery =
  "SELECT ?s ?name WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name ; " +
  "<http://xmlns.com/foaf/0.1/age> ?age " +
  "FILTER(STRLEN(?name) > 9 && ?age >= 40 && ?age < 45) }";
const orderLimitQuery =
  "SELECT ?name ?age WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name ; " +
  "<http://xmlns.com/foaf/0.1/age> ?age } ORDER BY ?name LIMIT 50";
const distinctQuery =
  "SELECT DISTINCT ?city WHERE { ?s <http://example.org/city> ?city }";
const valuesBindQuery = "SELECT ?person ?double WHERE { VALUES ?person { " +
  "<http://example.org/person0> <http://example.org/person5> " +
  "<http://example.org/person10> } " +
  "?person <http://xmlns.com/foaf/0.1/age> ?age BIND(?age * 2 AS ?double) }";
const graphQuery = "SELECT ?s ?o WHERE { GRAPH <http://example.org/g1> { " +
  "?s <http://example.org/g1prop> ?o } }";
const fromQuery = "SELECT ?s ?o FROM <http://example.org/g1> WHERE { " +
  "?s <http://example.org/g1prop> ?o }";

// --- 100%-era feature surface ---
// Subqueries: a WHERE subquery joined with the outer pattern, an aggregate
// subquery, and a nested subquery.
const subqueryQuery = "SELECT ?s ?n WHERE { " +
  "?s <http://xmlns.com/foaf/0.1/age> ?age . " +
  "{ SELECT ?s ?n WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n } } }";
const subqueryAggQuery = "SELECT ?city ?cnt WHERE { " +
  "{ SELECT ?city (COUNT(?s) AS ?cnt) WHERE { ?s <http://example.org/city> ?city } " +
  "GROUP BY ?city } }";
const subqueryNestedQuery = "SELECT ?s WHERE { " +
  "{ SELECT ?s WHERE { { SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n } } " +
  "?s <http://example.org/city> ?city } } }";

// EXISTS / NOT EXISTS filters over the spouse edge (even-indexed people only).
const existsQuery =
  "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
  "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse } }";
const notExistsQuery =
  "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
  "FILTER NOT EXISTS { ?s <http://example.org/spouse> ?spouse } }";
// Nested EXISTS: an EXISTS inside the EXISTS body. Every spouse (odd-indexed
// person) has a name, so the inner EXISTS always holds and the even-indexed
// people (who have a spouse) pass — same shape as the simple EXISTS, plus one
// inner probe per passing solution.
const nestedExistsQuery =
  "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
  "FILTER EXISTS { ?s <http://example.org/spouse> ?spouse . " +
  "FILTER EXISTS { ?spouse <http://xmlns.com/foaf/0.1/name> ?n2 } } }";
// Nested EXISTS inside NOT EXISTS: the body matches only even-indexed people
// (spouse present and named), so the negation keeps the odd-indexed ones.
const nestedNotExistsQuery =
  "SELECT ?s WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n " +
  "FILTER NOT EXISTS { ?s <http://example.org/spouse> ?spouse . " +
  "FILTER EXISTS { ?spouse <http://xmlns.com/foaf/0.1/name> ?n2 } } }";

// XSD cast constructors over the integer age literal, plus boolean and
// dateTime casts from string constants (the shared dataset carries no
// boolean/dateTime literals). The xsd prefix is declared explicitly because
// Oxigraph requires it for cast-function syntax. xsd:double is omitted: wazoo
// and Comunica emit the canonical "2.0E1" lexical form while Oxigraph emits
// "20", so a three-engine lexical comparison cannot cross-verify it.
const castNumericQuery = "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> " +
  "SELECT ?s (xsd:integer(?age) AS ?i) " +
  "(xsd:decimal(?age) AS ?dec) " +
  "(xsd:float(?age) AS ?flt) (xsd:string(?age) AS ?str) WHERE { " +
  "?s <http://xmlns.com/foaf/0.1/age> ?age }";
const castBooleanQuery = "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> " +
  'SELECT ?s (xsd:boolean("true") AS ?b) WHERE { ' +
  "?s <http://xmlns.com/foaf/0.1/name> ?n }";
const castDateTimeQuery = "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> " +
  'SELECT ?s (xsd:dateTime("2011-01-10T14:45:13Z") AS ?dt) ' +
  "WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?n }";

// String/datatype functions. LANG/LANGMATCHES use a lang-tagged literal in the
// query itself (the shared dataset carries no language tags).
const stringConcatQuery = 'SELECT ?s (CONCAT(?name, "!") AS ?c) WHERE { ' +
  "?s <http://xmlns.com/foaf/0.1/name> ?name }";
const stringBeforeAfterQuery = 'SELECT ?s (STRBEFORE(?name, " ") AS ?b) ' +
  '(STRAFTER(?name, " ") AS ?a) WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name }';
const stringReplaceQuery = 'SELECT ?s (REPLACE(?name, "Person", "P") AS ?r) ' +
  "WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name }";
const stringEncodeUriQuery =
  "SELECT ?s (ENCODE_FOR_URI(?name) AS ?e) WHERE { " +
  "?s <http://xmlns.com/foaf/0.1/name> ?name }";
const stringDatatypeQuery = "SELECT ?s (DATATYPE(?age) AS ?dt) WHERE { " +
  "?s <http://xmlns.com/foaf/0.1/age> ?age }";
const stringLangQuery = 'SELECT ?s (LANG("hello"@en) AS ?l) ' +
  '(LANGMATCHES(LANG("hello"@en), "EN") AS ?m) WHERE { ' +
  "?s <http://xmlns.com/foaf/0.1/name> ?name }";
const stringIriQuery = 'SELECT ?s (IRI(CONCAT(STR(?s), "#frag")) AS ?iri) ' +
  "WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name }";

// HAVING alongside GROUP BY (city groups are uniformly 80, so HAVING > 60
// keeps all five groups while exercising the filter path).
const havingQuery = "SELECT ?city (COUNT(*) AS ?cnt) WHERE { " +
  "?s <http://example.org/city> ?city } GROUP BY ?city HAVING (COUNT(*) > 60)";

// REDUCED (≡ DISTINCT per the REDUCED decision).
const reducedQuery =
  "SELECT REDUCED ?city WHERE { ?s <http://example.org/city> ?city }";

// CONSTRUCT with an RDF list: each solution mints a fresh blank node, the
// fresh-per-solution blank-node path.
const constructListQuery = "CONSTRUCT { " +
  "?s <http://example.org/nameList> [ " +
  "<http://www.w3.org/1999/02/22-rdf-syntax-ns#first> ?name ; " +
  "<http://www.w3.org/1999/02/22-rdf-syntax-ns#rest> <http://www.w3.org/1999/02/22-rdf-syntax-ns#nil> ] } " +
  "WHERE { ?s <http://xmlns.com/foaf/0.1/name> ?name }";

// Remaining update ops on named graphs (g1 = source, g2 = pre-seeded
// destination), plain and SILENT forms.
const clearGraphQuery = "CLEAR GRAPH <http://example.org/g1>";
const clearGraphSilentQuery = "CLEAR SILENT GRAPH <http://example.org/g1>";
const dropGraphQuery = "DROP GRAPH <http://example.org/g1>";
const dropGraphSilentQuery = "DROP SILENT GRAPH <http://example.org/g1>";
const addGraphQuery =
  "ADD GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";
const addGraphSilentQuery =
  "ADD SILENT GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";
const copyGraphQuery =
  "COPY GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";
const copyGraphSilentQuery =
  "COPY SILENT GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";
const moveGraphQuery =
  "MOVE GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";
const moveGraphSilentQuery =
  "MOVE SILENT GRAPH <http://example.org/g1> TO GRAPH <http://example.org/g2>";

/**
 * OxigraphBinding is the structural binding shape Oxigraph returns.
 */
type OxigraphBinding = {
  get(name: string): unknown;
  keys(): IterableIterator<unknown>;
};

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

/**
 * quadRecord renders a quad as a deterministic string.
 */
function quadRecord(
  item: rdfjs.Quad,
  canonicalize: (term: rdfjs.Term) => CanonicalTerm,
): string {
  return [item.subject, item.predicate, item.object, item.graph]
    .map((term) => JSON.stringify(canonicalize(term)))
    .join(" ");
}

/**
 * dedupeRecords keeps one copy of each distinct canonical record, preserving
 * first-occurrence order. Reference-engine CONSTRUCT streams may repeat a
 * triple their graph would not, so the reference side of a cross-engine
 * comparison is normalized to graph content before comparing — the wazoo
 * side stays as-emitted (issue #87 contract).
 */
function dedupeRecords<T>(records: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const record of records) {
    const key = JSON.stringify(record);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

/**
 * quadRecords projects quads into ordered [s, p, o, g] canonical term lists,
 * the record shape the blank-node-isomorphic comparison operates on.
 */
function quadRecords(
  quads: rdfjs.Quad[],
  canonicalize: (term: rdfjs.Term) => CanonicalTerm,
): CanonicalTerm[][] {
  return quads.map((item) => [
    canonicalize(item.subject),
    canonicalize(item.predicate),
    canonicalize(item.object),
    canonicalize(item.graph),
  ]);
}

/**
 * isomorphicMultiset compares two record multisets (each record an ordered
 * list of canonical terms) up to blank-node renaming. Blank-node labels are
 * engine-local and unobservable, so CONSTRUCT templates that mint fresh blank
 * nodes per solution agree exactly when a consistent relabeling makes them
 * equal.
 */
function isomorphicMultiset(
  a: CanonicalTerm[][],
  b: CanonicalTerm[][],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const ac = canonicalizeBnodes(a).sort();
  const bc = canonicalizeBnodes(b).sort();
  for (let index = 0; index < ac.length; index++) {
    if (ac[index] !== bc[index]) {
      return false;
    }
  }
  return true;
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
 * oxigraphBindingRecord renders an Oxigraph binding as a canonical string.
 */
function oxigraphBindingRecord(binding: OxigraphBinding): string {
  const record: Record<string, CanonicalTerm> = {};
  for (const key of binding.keys()) {
    const name = typeof key === "string"
      ? key
      : (key as { value: string }).value;
    const term = binding.get(name);
    if (term !== undefined && term !== null) {
      record[name] = canonicalizeRdfTerm(term as unknown as rdfjs.Term);
    }
  }
  return bindingRecord(record);
}

/**
 * verifySelectEquality asserts all three engines return identical SELECT
 * results for the given query, so benchmark timings compare like for like.
 */
interface EngineTrio {
  wazoo: WazooSparqlEngine;
  comunicaStore: Store;
  oxigraph: OxigraphStore;
}

const mainTrio: EngineTrio = {
  wazoo: wazooEngine,
  comunicaStore: memoryStore,
  oxigraph: oxigraphStore,
};
const largeTrio: EngineTrio = {
  wazoo: largeWazooEngine,
  comunicaStore: largeMemoryStore,
  oxigraph: largeOxigraphStore,
};
const graphTrio: EngineTrio = {
  wazoo: graphWazooEngine,
  comunicaStore: graphMemoryStore,
  oxigraph: graphOxigraphStore,
};

async function verifySelectEquality(
  query: string,
  label: string,
  trio: EngineTrio = mainTrio,
): Promise<void> {
  const wazooResult = await trio.wazoo.execute({ query });
  if (wazooResult.kind !== "select") {
    throw new Error(`${label}: wazoo engine returned ${wazooResult.kind}`);
  }
  const wazooSet = wazooResult.data.results.bindings
    .map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeSparqlValue(binding[name]);
      }
      return bindingRecord(record);
    })
    .sort();

  const comunicaBindings = await runComunicaRawSelectBindings(
    comunicaEngine,
    query,
    trio.comunicaStore,
  );
  const comunicaSet = comunicaBindings
    .map((binding) => {
      const record: Record<string, CanonicalTerm> = {};
      for (const name of Object.keys(binding)) {
        record[name] = canonicalizeComunicaTerm(binding[name]);
      }
      return bindingRecord(record);
    })
    .sort();

  const oxigraphBindings = trio.oxigraph.query(
    query,
  ) as unknown as OxigraphBinding[];
  const oxigraphSet = oxigraphBindings.map(oxigraphBindingRecord).sort();

  assertEquals(
    wazooSet,
    comunicaSet,
    `${label}: wazoo and comunica disagree`,
  );
  assertEquals(
    wazooSet,
    oxigraphSet,
    `${label}: wazoo and oxigraph disagree`,
  );
}

/**
 * verifyAskEquality asserts all three engines return the same ASK boolean.
 */
async function verifyAskEquality(query: string, label: string): Promise<void> {
  const wazooResult = await wazooEngine.execute({ query });
  if (wazooResult.kind !== "ask") {
    throw new Error(`${label}: wazoo engine returned ${wazooResult.kind}`);
  }
  const comunicaBoolean = await comunicaEngine.queryBoolean(query, {
    sources: [memoryStore],
  });
  const oxigraphBoolean = oxigraphStore.query(query) as boolean;

  assertEquals(
    wazooResult.data.boolean,
    comunicaBoolean,
    `${label}: wazoo and comunica disagree`,
  );
  assertEquals(
    wazooResult.data.boolean,
    oxigraphBoolean,
    `${label}: wazoo and oxigraph disagree`,
  );
}

/**
 * verifyConstructEquality asserts all three engines produce identical
 * CONSTRUCT quad sets.
 */
async function verifyConstructEquality(
  query: string,
  label: string,
): Promise<void> {
  const wazooResult = await wazooEngine.execute({ query });
  if (wazooResult.kind !== "construct") {
    throw new Error(`${label}: wazoo engine returned ${wazooResult.kind}`);
  }
  const wazooSet = wazooResult.data.quads
    .map((item) => quadRecord(item, canonicalizeRdfTerm))
    .sort();

  const comunicaStream = await comunicaEngine.queryQuads(query, {
    sources: [memoryStore],
  });
  const comunicaQuads = await comunicaStream.toArray();
  // Reference sides are normalized to graph content (issue #87 contract);
  // the wazoo side above stays as-emitted.
  const comunicaSet = dedupeRecords(
    comunicaQuads.map((item) => quadRecord(item, canonicalizeComunicaTerm)),
  ).sort();

  const oxigraphQuads = oxigraphStore.query(
    query,
  ) as unknown as rdfjs.Quad[];
  const oxigraphSet = dedupeRecords(
    oxigraphQuads.map((item) => quadRecord(item, canonicalizeRdfTerm)),
  ).sort();

  assertEquals(
    wazooSet,
    comunicaSet,
    `${label}: wazoo and comunica disagree`,
  );
  assertEquals(
    wazooSet,
    oxigraphSet,
    `${label}: wazoo and oxigraph disagree`,
  );
}

/**
 * verifyConstructIsoEquality asserts all three engines produce isomorphic
 * CONSTRUCT quad sets for the given query, comparing up to blank-node
 * renaming (fresh blank nodes minted per solution carry engine-local labels).
 */
async function verifyConstructIsoEquality(
  query: string,
  label: string,
): Promise<void> {
  const wazooResult = await wazooEngine.execute({ query });
  if (wazooResult.kind !== "construct") {
    throw new Error(`${label}: wazoo engine returned ${wazooResult.kind}`);
  }
  const wazooRecords = quadRecords(
    wazooResult.data.quads,
    canonicalizeRdfTerm,
  );

  const comunicaStream = await comunicaEngine.queryQuads(query, {
    sources: [memoryStore],
  });
  const comunicaQuads = await comunicaStream.toArray();
  // Reference sides are normalized to graph content (issue #87 contract);
  // the wazoo side above stays as-emitted.
  const comunicaRecords = dedupeRecords(
    quadRecords(comunicaQuads, canonicalizeComunicaTerm),
  );

  const oxigraphQuads = oxigraphStore.query(
    query,
  ) as unknown as rdfjs.Quad[];
  const oxigraphRecords = dedupeRecords(
    quadRecords(oxigraphQuads, canonicalizeRdfTerm),
  );

  assertEquals(
    isomorphicMultiset(wazooRecords, comunicaRecords),
    true,
    `${label}: wazoo and comunica disagree up to blank-node isomorphism`,
  );
  assertEquals(
    isomorphicMultiset(wazooRecords, oxigraphRecords),
    true,
    `${label}: wazoo and oxigraph disagree up to blank-node isomorphism`,
  );
}

/**
 * storeQuadStrings renders a store's full contents as a sorted list of
 * canonical quad strings.
 */
function storeQuadStrings(store: Store): string[] {
  const quads: rdfjs.Quad[] = store.getQuads(null, null, null, null);
  return quads.map((item) => quadRecord(item, canonicalizeRdfTerm)).sort();
}

/**
 * verifyUpdateEquality asserts all three engines produce identical final
 * store contents after running the given update. Each engine mutates its own
 * freshly seeded store (defaulting to the main dataset, or a named-graph seed
 * for graph-management ops), so the update is genuinely executed rather than
 * compared against pre-existing state. Oxigraph is dumped with match() so
 * named-graph quads are included.
 */
async function verifyUpdateEquality(
  query: string,
  label: string,
  seed: rdfjs.Quad[] = dataset,
): Promise<void> {
  const wazooStore = seedStore(seed);
  const wazooUpdateEngine = new WazooSparqlEngine({ store: wazooStore });
  const wazooResult = await wazooUpdateEngine.execute({ query });
  if (wazooResult.kind !== "void") {
    throw new Error(`${label}: wazoo engine returned ${wazooResult.kind}`);
  }
  const wazooSet = storeQuadStrings(wazooStore);

  const comunicaStore = seedStore(seed);
  await comunicaEngine.queryVoid(query, { sources: [comunicaStore] });
  const comunicaSet = storeQuadStrings(comunicaStore);

  const oxigraphUpdateStore = seedOxigraphStore(seed);
  await oxigraphUpdateStore.update(query);
  const oxigraphQuads = oxigraphUpdateStore.match(
    null,
    null,
    null,
    null,
  ) as unknown as rdfjs.Quad[];
  const oxigraphSet = oxigraphQuads
    .map((item) => quadRecord(item, canonicalizeRdfTerm))
    .sort();

  assertEquals(
    wazooSet,
    comunicaSet,
    `${label}: wazoo and comunica disagree`,
  );
  assertEquals(
    wazooSet,
    oxigraphSet,
    `${label}: wazoo and oxigraph disagree`,
  );
}

// Fail the whole benchmark run loudly if the engines do not agree, so the
// timings below always compare equivalent work.
await verifySelectEquality(scanQuery, "scan");
await verifySelectEquality(joinQuery, "join");
await verifySelectEquality(asymJoinQuery, "asym-join");
await verifyAskEquality(askQuery, "ask");
await verifyConstructEquality(constructQuery, "construct");
await verifyUpdateEquality(moveUpdateQuery, "update-move");
await verifyUpdateEquality(rewriteUpdateQuery, "update-rewrite");
await verifySelectEquality(chainQuery, "reorder-chain");
await verifySelectEquality(optionalQuery, "optional");
await verifySelectEquality(minusQuery, "minus");
await verifySelectEquality(unionQuery, "union");
await verifySelectEquality(pathSeqQuery, "path-seq");
await verifySelectEquality(pathPlusQuery, "path-plus");
await verifySelectEquality(groupAggQuery, "group-aggregate");
await verifySelectEquality(filterExprQuery, "filter-expr");
await verifySelectEquality(orderLimitQuery, "order-limit");
await verifySelectEquality(distinctQuery, "distinct");
await verifySelectEquality(valuesBindQuery, "values-bind");
await verifySelectEquality(graphQuery, "graph", graphTrio);
await verifySelectEquality(fromQuery, "from", graphTrio);
// 100%-era surface.
await verifySelectEquality(subqueryQuery, "subquery");
await verifySelectEquality(subqueryAggQuery, "subquery-agg");
await verifySelectEquality(subqueryNestedQuery, "subquery-nested");
await verifySelectEquality(existsQuery, "exists");
await verifySelectEquality(notExistsQuery, "not-exists");
await verifySelectEquality(nestedExistsQuery, "nested-exists");
await verifySelectEquality(nestedNotExistsQuery, "nested-not-exists");
// The same EXISTS queries must agree on the 10k-subject dataset before the
// scaling timings compare equivalent work across engines.
await verifySelectEquality(existsQuery, "exists-large", largeTrio);
await verifySelectEquality(notExistsQuery, "not-exists-large", largeTrio);
await verifySelectEquality(nestedExistsQuery, "nested-exists-large", largeTrio);
await verifySelectEquality(
  nestedNotExistsQuery,
  "nested-not-exists-large",
  largeTrio,
);
// The 10k join-scaling queries must also agree across engines before timing.
await verifySelectEquality(unionJoinQuery, "union-join-large", largeTrio);
await verifySelectEquality(optionalJoinQuery, "optional-join-large", largeTrio);
await verifySelectEquality(minusJoinQuery, "minus-join-large", largeTrio);
await verifySelectEquality(castNumericQuery, "cast-numeric");
await verifySelectEquality(castBooleanQuery, "cast-boolean");
await verifySelectEquality(castDateTimeQuery, "cast-dateTime");
await verifySelectEquality(stringConcatQuery, "string-concat");
await verifySelectEquality(stringBeforeAfterQuery, "string-before-after");
await verifySelectEquality(stringReplaceQuery, "string-replace");
await verifySelectEquality(stringEncodeUriQuery, "string-encode-uri");
await verifySelectEquality(stringDatatypeQuery, "string-datatype");
await verifySelectEquality(stringLangQuery, "string-lang");
await verifySelectEquality(stringIriQuery, "string-iri");
await verifySelectEquality(havingQuery, "having");
await verifySelectEquality(reducedQuery, "reduced");
await verifyConstructIsoEquality(constructListQuery, "construct-list");
await verifyUpdateEquality(clearGraphQuery, "clear-graph", graphOpsDataset);
await verifyUpdateEquality(
  clearGraphSilentQuery,
  "clear-graph-silent",
  graphOpsDataset,
);
await verifyUpdateEquality(dropGraphQuery, "drop-graph", graphOpsDataset);
await verifyUpdateEquality(
  dropGraphSilentQuery,
  "drop-graph-silent",
  graphOpsDataset,
);
await verifyUpdateEquality(addGraphQuery, "add-graph", graphOpsDataset);
await verifyUpdateEquality(
  addGraphSilentQuery,
  "add-graph-silent",
  graphOpsDataset,
);
await verifyUpdateEquality(copyGraphQuery, "copy-graph", graphOpsDataset);
await verifyUpdateEquality(
  copyGraphSilentQuery,
  "copy-graph-silent",
  graphOpsDataset,
);
await verifyUpdateEquality(moveGraphQuery, "move-graph", graphOpsDataset);
await verifyUpdateEquality(
  moveGraphSilentQuery,
  "move-graph-silent",
  graphOpsDataset,
);

Deno.bench(
  { name: "wazoo - scan", group: "scan", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: scanQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo scan returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - scan", group: "scan" }, async () => {
  const stream = await comunicaEngine.queryBindings(scanQuery, {
    sources: [memoryStore],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica scan returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - scan", group: "scan" }, () => {
  const result = oxigraphStore.query(scanQuery) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph scan returned no bindings");
  }
});

Deno.bench(
  { name: "wazoo - join", group: "join", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: joinQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo join returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - join", group: "join" }, async () => {
  const stream = await comunicaEngine.queryBindings(joinQuery, {
    sources: [memoryStore],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica join returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - join", group: "join" }, () => {
  const result = oxigraphStore.query(joinQuery) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph join returned no bindings");
  }
});

Deno.bench(
  { name: "wazoo - asym (reorder on)", group: "asym-join", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: asymJoinQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo asym join returned no bindings");
    }
  },
);

Deno.bench(
  { name: "wazoo - asym (reorder off)", group: "asym-join" },
  async () => {
    const result = await wazooEngineNoReorder.execute({
      query: asymJoinQuery,
    });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo asym join (no reorder) returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - asym", group: "asym-join" }, async () => {
  const stream = await comunicaEngine.queryBindings(asymJoinQuery, {
    sources: [memoryStore],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica asym join returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - asym", group: "asym-join" }, () => {
  const result = oxigraphStore.query(
    asymJoinQuery,
  ) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph asym join returned no bindings");
  }
});

Deno.bench(
  {
    name: "wazoo - chain (reorder on)",
    group: "reorder-chain",
    baseline: true,
  },
  async () => {
    const result = await wazooEngine.execute({ query: chainQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo chain returned no bindings");
    }
  },
);

Deno.bench(
  { name: "wazoo - chain (reorder off)", group: "reorder-chain" },
  async () => {
    const result = await wazooEngineNoReorder.execute({ query: chainQuery });
    if (result.kind !== "select" || result.data.results.bindings.length === 0) {
      throw new Error("wazoo chain (no reorder) returned no bindings");
    }
  },
);

Deno.bench({ name: "comunica - chain", group: "reorder-chain" }, async () => {
  const stream = await comunicaEngine.queryBindings(chainQuery, {
    sources: [memoryStore],
  });
  const bindings = await stream.toArray();
  if (bindings.length === 0) {
    throw new Error("comunica chain returned no bindings");
  }
});

Deno.bench({ name: "oxigraph - chain", group: "reorder-chain" }, () => {
  const result = oxigraphStore.query(
    chainQuery,
  ) as unknown as OxigraphBinding[];
  if (result.length === 0) {
    throw new Error("oxigraph chain returned no bindings");
  }
});

Deno.bench(
  { name: "wazoo - ask", group: "ask", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: askQuery });
    if (result.kind !== "ask" || !result.data.boolean) {
      throw new Error("wazoo ask returned an unexpected result");
    }
  },
);

Deno.bench({ name: "comunica - ask", group: "ask" }, async () => {
  const result = await comunicaEngine.queryBoolean(askQuery, {
    sources: [memoryStore],
  });
  if (!result) {
    throw new Error("comunica ask returned an unexpected result");
  }
});

Deno.bench({ name: "oxigraph - ask", group: "ask" }, () => {
  const result = oxigraphStore.query(askQuery) as boolean;
  if (!result) {
    throw new Error("oxigraph ask returned an unexpected result");
  }
});

Deno.bench(
  { name: "wazoo - construct", group: "construct", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: constructQuery });
    if (result.kind !== "construct" || result.data.quads.length === 0) {
      throw new Error("wazoo construct returned no quads");
    }
  },
);

Deno.bench({ name: "comunica - construct", group: "construct" }, async () => {
  const stream = await comunicaEngine.queryQuads(constructQuery, {
    sources: [memoryStore],
  });
  const quads = await stream.toArray();
  if (quads.length === 0) {
    throw new Error("comunica construct returned no quads");
  }
});

Deno.bench({ name: "oxigraph - construct", group: "construct" }, () => {
  const result = oxigraphStore.query(
    constructQuery,
  ) as unknown as rdfjs.Quad[];
  if (result.length === 0) {
    throw new Error("oxigraph construct returned no quads");
  }
});

Deno.bench(
  { name: "wazoo - update", group: "update", baseline: true },
  async () => {
    const result = await wazooEngine.execute({ query: rewriteUpdateQuery });
    if (result.kind !== "void") {
      throw new Error("wazoo update returned a non-void result");
    }
  },
);

Deno.bench({ name: "comunica - update", group: "update" }, async () => {
  await comunicaEngine.queryVoid(rewriteUpdateQuery, {
    sources: [memoryStore],
  });
});

Deno.bench({ name: "oxigraph - update", group: "update" }, async () => {
  await oxigraphStore.update(rewriteUpdateQuery);
});

/* ------------------------------------------------------------------ */
/* Inventory mode (bench:latency:check)                              */
/* ------------------------------------------------------------------ */

/**
 * BENCH_INVENTORY runs every registered bench exactly once with no warmup, so
 * the CI staleness check (`deno task bench:latency:check`) can compare the
 * suite's bench inventory against the committed bench/latency-data.json
 * snapshot without paying for full timing runs. Timings under this mode are
 * meaningless — only the registered (group, name, baseline) set is used.
 */
const BENCH_INVENTORY = Deno.env.get("BENCH_INVENTORY") === "1";
const INVENTORY_BENCH_OPTIONS = { warmup: 0, iterations: 1 } as const;

function benchOptions(
  options?: { warmup?: number; iterations?: number },
): { warmup?: number; iterations?: number } {
  return BENCH_INVENTORY ? INVENTORY_BENCH_OPTIONS : (options ?? {});
}

/**
 * benchSelectTrio registers the wazoo/comunica/oxigraph bench trio for one
 * SELECT group. Wazoo is the baseline; each body asserts a non-empty result
 * so a silently-broken engine fails loudly mid-run.
 */
function benchSelectTrio(
  group: string,
  query: string,
  label: string,
  trio: EngineTrio = mainTrio,
  options?: { warmup?: number; iterations?: number },
): void {
  Deno.bench(
    {
      name: `wazoo - ${label}`,
      group,
      baseline: true,
      ...benchOptions(options),
    },
    async () => {
      const result = await trio.wazoo.execute({ query });
      if (
        result.kind !== "select" ||
        result.data.results.bindings.length === 0
      ) {
        throw new Error(`wazoo ${label} returned no bindings`);
      }
    },
  );

  Deno.bench(
    { name: `comunica - ${label}`, group, ...benchOptions() },
    async () => {
      const stream = await comunicaEngine.queryBindings(query, {
        sources: [trio.comunicaStore],
      });
      const bindings = await stream.toArray();
      if (bindings.length === 0) {
        throw new Error(`comunica ${label} returned no bindings`);
      }
    },
  );

  Deno.bench(
    { name: `oxigraph - ${label}`, group, ...benchOptions() },
    () => {
      const result = trio.oxigraph.query(query) as unknown as OxigraphBinding[];
      if (result.length === 0) {
        throw new Error(`oxigraph ${label} returned no bindings`);
      }
    },
  );
}

/**
 * benchConstructTrio registers the wazoo/comunica/oxigraph bench trio for
 * one CONSTRUCT group. Wazoo is the baseline; each body asserts a non-empty
 * result so a silently-broken engine fails loudly mid-run.
 */
function benchConstructTrio(
  group: string,
  query: string,
  label: string,
): void {
  Deno.bench(
    { name: `wazoo - ${label}`, group, baseline: true, ...benchOptions() },
    async () => {
      const result = await wazooEngine.execute({ query });
      if (result.kind !== "construct" || result.data.quads.length === 0) {
        throw new Error(`wazoo ${label} returned no quads`);
      }
    },
  );

  Deno.bench(
    { name: `comunica - ${label}`, group, ...benchOptions() },
    async () => {
      const stream = await comunicaEngine.queryQuads(query, {
        sources: [memoryStore],
      });
      const quads = await stream.toArray();
      if (quads.length === 0) {
        throw new Error(`comunica ${label} returned no quads`);
      }
    },
  );

  Deno.bench(
    { name: `oxigraph - ${label}`, group, ...benchOptions() },
    () => {
      const result = oxigraphStore.query(query) as unknown as rdfjs.Quad[];
      if (result.length === 0) {
        throw new Error(`oxigraph ${label} returned no quads`);
      }
    },
  );
}

/**
 * benchUpdateTrio registers the wazoo/comunica/oxigraph bench trio for one
 * update group. Each iteration seeds a fresh store (the graph-management ops
 * are one-way mutations, unlike the self-restoring rewrite update), so the
 * timings never observe a drifted store.
 */
function benchUpdateTrio(
  group: string,
  query: string,
  label: string,
  seed: rdfjs.Quad[],
): void {
  Deno.bench(
    { name: `wazoo - ${label}`, group, baseline: true, ...benchOptions() },
    async () => {
      const store = seedStore(seed);
      const engine = new WazooSparqlEngine({ store });
      const result = await engine.execute({ query });
      if (result.kind !== "void") {
        throw new Error(`wazoo ${label} returned a non-void result`);
      }
    },
  );

  Deno.bench(
    { name: `comunica - ${label}`, group, ...benchOptions() },
    async () => {
      const store = seedStore(seed);
      await comunicaEngine.queryVoid(query, { sources: [store] });
    },
  );

  Deno.bench(
    { name: `oxigraph - ${label}`, group, ...benchOptions() },
    async () => {
      const store = seedOxigraphStore(seed);
      await store.update(query);
    },
  );
}

benchSelectTrio("optional", optionalQuery, "optional");
benchSelectTrio("minus", minusQuery, "minus");
benchSelectTrio("union", unionQuery, "union");
benchSelectTrio("path", pathSeqQuery, "path-seq");
benchSelectTrio("path", pathPlusQuery, "path-plus");
benchSelectTrio("group-aggregate", groupAggQuery, "group-aggregate");
benchSelectTrio("filter-expr", filterExprQuery, "filter-expr");
benchSelectTrio("order-limit", orderLimitQuery, "order-limit");
benchSelectTrio("distinct", distinctQuery, "distinct");
benchSelectTrio("values-bind", valuesBindQuery, "values-bind");
benchSelectTrio("graph", graphQuery, "graph", graphTrio);
benchSelectTrio("from", fromQuery, "from", graphTrio);
// 100%-era surface.
benchSelectTrio("subquery", subqueryQuery, "subquery");
benchSelectTrio("subquery", subqueryAggQuery, "subquery-agg");
benchSelectTrio("subquery", subqueryNestedQuery, "subquery-nested");
// The wazoo EXISTS path is the suite's slowest (tens of ms/iter), so it
// needs a longer warmup than the 500 ms default for stable, comparable rows
// (V8 must finish optimizing the hot EXISTS machinery before measurement),
// plus more samples to average out scheduler noise.
const EXISTS_BENCH_OPTIONS = { warmup: 3_000, iterations: 50 };
benchSelectTrio(
  "exists",
  existsQuery,
  "exists",
  mainTrio,
  EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists",
  notExistsQuery,
  "not-exists",
  mainTrio,
  EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists",
  nestedExistsQuery,
  "nested-exists",
  mainTrio,
  EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists",
  nestedNotExistsQuery,
  "nested-not-exists",
  mainTrio,
  EXISTS_BENCH_OPTIONS,
);
// 10k-subject scaling rows: each iteration is ~25x heavier than the 400-person
// rows, so fewer samples suffice for stable numbers.
const LARGE_EXISTS_BENCH_OPTIONS = { warmup: 2_000, iterations: 10 };
benchSelectTrio(
  "exists-large",
  existsQuery,
  "exists",
  largeTrio,
  LARGE_EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists-large",
  notExistsQuery,
  "not-exists",
  largeTrio,
  LARGE_EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists-large",
  nestedExistsQuery,
  "nested-exists",
  largeTrio,
  LARGE_EXISTS_BENCH_OPTIONS,
);
benchSelectTrio(
  "exists-large",
  nestedNotExistsQuery,
  "nested-not-exists",
  largeTrio,
  LARGE_EXISTS_BENCH_OPTIONS,
);
// 10k join-scaling rows: the same shared-subject join surface as the
// 400-person rows but at 10k subjects, where the wazoo engine's hash join
// probes instead of scanning the whole right side per left binding.
const LARGE_JOIN_BENCH_OPTIONS = { warmup: 2_000, iterations: 30 };
benchSelectTrio(
  "join-large",
  unionJoinQuery,
  "union",
  largeTrio,
  LARGE_JOIN_BENCH_OPTIONS,
);
benchSelectTrio(
  "join-large",
  optionalJoinQuery,
  "optional",
  largeTrio,
  LARGE_JOIN_BENCH_OPTIONS,
);
benchSelectTrio(
  "join-large",
  minusJoinQuery,
  "minus",
  largeTrio,
  LARGE_JOIN_BENCH_OPTIONS,
);
benchSelectTrio("cast", castNumericQuery, "cast-numeric");
benchSelectTrio("cast", castBooleanQuery, "cast-boolean");
benchSelectTrio("cast", castDateTimeQuery, "cast-dateTime");
benchSelectTrio("string-fn", stringConcatQuery, "string-concat");
benchSelectTrio("string-fn", stringBeforeAfterQuery, "string-before-after");
benchSelectTrio("string-fn", stringReplaceQuery, "string-replace");
benchSelectTrio("string-fn", stringEncodeUriQuery, "string-encode-uri");
benchSelectTrio("string-fn", stringDatatypeQuery, "string-datatype");
benchSelectTrio("string-fn", stringLangQuery, "string-lang");
benchSelectTrio("string-fn", stringIriQuery, "string-iri");
benchSelectTrio("group-aggregate", havingQuery, "having");
benchSelectTrio("reduced", reducedQuery, "reduced");
benchConstructTrio("construct", constructListQuery, "construct-list");
benchUpdateTrio("update-ops", clearGraphQuery, "clear-graph", graphOpsDataset);
benchUpdateTrio(
  "update-ops",
  clearGraphSilentQuery,
  "clear-graph-silent",
  graphOpsDataset,
);
benchUpdateTrio("update-ops", dropGraphQuery, "drop-graph", graphOpsDataset);
benchUpdateTrio(
  "update-ops",
  dropGraphSilentQuery,
  "drop-graph-silent",
  graphOpsDataset,
);
benchUpdateTrio("update-ops", addGraphQuery, "add-graph", graphOpsDataset);
benchUpdateTrio(
  "update-ops",
  addGraphSilentQuery,
  "add-graph-silent",
  graphOpsDataset,
);
benchUpdateTrio("update-ops", copyGraphQuery, "copy-graph", graphOpsDataset);
benchUpdateTrio(
  "update-ops",
  copyGraphSilentQuery,
  "copy-graph-silent",
  graphOpsDataset,
);
benchUpdateTrio("update-ops", moveGraphQuery, "move-graph", graphOpsDataset);
benchUpdateTrio(
  "update-ops",
  moveGraphSilentQuery,
  "move-graph-silent",
  graphOpsDataset,
);

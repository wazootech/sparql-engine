import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import type { MemoryStore } from "@/store/memory-store.ts";
import { RDF_FIRST, RDF_NIL, RDF_REST, RDFS } from "./manifest-vocab.ts";
import type { W3cGraphData } from "./manifest-types.ts";

/**
 * listTerms walks an RDF list (rdf:first/rdf:rest) collecting its terms.
 */
export function listTerms(store: MemoryStore, head: rdfjs.Term): rdfjs.Term[] {
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
export function collectValues(
  store: MemoryStore,
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

export function rdfjsNamedNode(value: string): rdfjs.NamedNode {
  return DataFactory.namedNode(value);
}

export function filePath(term: rdfjs.Term): string {
  return term.value.split("/").pop() ?? "";
}

/**
 * collectGraphData gathers graphData entries: each object is either a file
 * IRI (unlabeled → graph named by that file's resolved IRI) or a blank node
 * with a ut:graph file and an rdfs:label graph name.
 */
export function collectGraphData(
  store: MemoryStore,
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

import { DataFactory } from "@/term/mod.ts";

const { namedNode } = DataFactory;

export const ex = (suffix: string) => namedNode(`http://example.org/${suffix}`);
export const s = ex("s");
export const p = ex("p");
export const o = ex("o");

export const RDF_REIFIES = "http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies";

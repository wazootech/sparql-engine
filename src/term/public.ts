// The published term surface: everything in mod.ts, with the DataFactory
// presented through its RDF/JS-typed boundary (rdfjs-data-factory.ts). The
// engine itself imports mod.ts / data-factory.ts and never this file, so the
// boundary cast stays outside the native-compiler program graph.
export * from "@/term/mod.ts";
export { DataFactory, dataFactory } from "@/term/rdfjs-data-factory.ts";
export type { InternalDataFactory } from "@/term/rdfjs-data-factory.ts";

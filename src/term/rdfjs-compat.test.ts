import type * as rdfjs from "@rdfjs/types";
import { assertEquals } from "@std/assert";
import { DataFactory } from "@/term/public.ts";
import { DataFactory as localFactory } from "@/term/data-factory.ts";
import type { RdfQuad, RdfTerm } from "@/parser/rdf-terms.ts";

// Type-level compatibility: the engine's local term types and @rdfjs/types are
// mutually assignable, and the published DataFactory keeps its RDF/JS
// signatures (generic NamedNode<Iri>, fromTerm overloads).
Deno.test("rdfjs compat: published DataFactory returns @rdfjs/types", () => {
  const iri: rdfjs.NamedNode<"http://example.org/a"> = DataFactory.namedNode(
    "http://example.org/a",
  );
  const lit: rdfjs.Literal = DataFactory.literal("x", "en");
  const q: rdfjs.Quad = DataFactory.quad(iri, iri, lit);
  const viaFactory: rdfjs.DataFactory = DataFactory;
  assertEquals(viaFactory.namedNode("http://example.org/a").equals(iri), true);
  assertEquals(q.object.equals(lit), true);
});

Deno.test("rdfjs compat: local terms and @rdfjs/types interchange", () => {
  const local: RdfTerm = localFactory.namedNode("http://example.org/b");
  const external: rdfjs.Term = local;
  const back: RdfTerm = external;
  const quad: RdfQuad = localFactory.quad(local, local, local);
  const externalQuad: rdfjs.Quad = quad;
  assertEquals(back.equals(local), true);
  assertEquals(externalQuad.subject.equals(local), true);
});

Deno.test("terms from the factory are deep-equal to each other", () => {
  assertEquals(
    localFactory.literal("a", "en"),
    localFactory.literal("a", "en"),
  );
});

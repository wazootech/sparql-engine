import type * as rdfjs from "@rdfjs/types";
import { escapeIri } from "@/serialize/turtle-escape.ts";
import { term } from "@/serialize/turtle-term.ts";

/**
 * TurtleWriterFormat selects the serialization dialect:
 *
 * - `"turtle"`  — Turtle, upgraded to TriG graph blocks when any quad carries
 *   a named graph (the parser's grammar is TriG-based, so this round-trips
 *   losslessly). A prefix map compacts IRIs that share a registered namespace.
 * - `"n-quads"` — one quad per line, graph label included.
 * - `"n-triples"` — one triple per line; named graphs are rejected because
 *   RDF 1.1 N-Triples cannot express them (lossless over lenient).
 */
export type TurtleFormat = "turtle" | "n-quads" | "n-triples";

/** TurtleWriterOptions configures serializeTurtle. */
export interface TurtleWriterOptions {
  /** Serialization dialect; defaults to `"turtle"`. */
  format?: TurtleFormat;

  /** Namespace prefixes: `{ prefix: namespace }`, emitted as `@prefix` lines. */
  prefixes?: Record<string, string>;
}

/**
 * serializeTurtle serializes RDF/JS quads into a Turtle-family document.
 *
 * It is the writer counterpart to `parseTurtleQuads`: the two round-trip
 * losslessly over Turtle, TriG, N-Quads, and N-Triples, including RDF 1.2
 * triple terms (`<<( s p o )>>`), directional language literals
 * (`"v"@en--ltr`), and named graphs. Output preserves input order and groups
 * statements by subject and predicate (`,` and `;` shorthand) in Turtle mode.
 *
 * @param quads   quads to serialize
 * @param options format and prefix configuration
 * @returns the serialized document (trailing newline, empty string for no quads)
 */
export function serializeTurtle(
  quads: Iterable<rdfjs.Quad>,
  options: TurtleWriterOptions = {},
): string {
  const format = options.format ?? "turtle";
  const quadArray = Array.from(quads);

  if (quadArray.length === 0) {
    return "";
  }

  if (format === "n-quads") {
    return quadArray
      .map((q) =>
        `${term(q.subject)} ${term(q.predicate)} ${term(q.object)}` +
        `${q.graph.termType === "DefaultGraph" ? "" : ` ${term(q.graph)}`} .`
      )
      .join("\n") + "\n";
  }

  if (format === "n-triples") {
    return quadArray.map((q) => {
      if (q.graph.termType !== "DefaultGraph") {
        throw new Error(
          "N-Triples cannot serialize quads with a named graph " +
            `(${term(q.graph)}); use Turtle or N-Quads for graph data.`,
        );
      }
      return `${term(q.subject)} ${term(q.predicate)} ${term(q.object)} .`;
    }).join("\n") + "\n";
  }

  // Turtle / TriG.
  const prefixes = options.prefixes ?? {};
  const prefixLines = Object.entries(prefixes).map(
    ([prefix, iri]) => `@prefix ${prefix}: <${escapeIri(iri)}> .`,
  );

  const defaultGraph: rdfjs.Quad[] = [];
  const byGraph = new Map<string, rdfjs.Quad[]>();
  for (const q of quadArray) {
    if (q.graph.termType === "DefaultGraph") {
      defaultGraph.push(q);
    } else {
      const key = term(q.graph);
      const bucket = byGraph.get(key);
      if (bucket) {
        bucket.push(q);
      } else {
        byGraph.set(key, [q]);
      }
    }
  }

  const lines = [...prefixLines];
  const defaultStatements = statementLines(defaultGraph, prefixes);
  lines.push(...defaultStatements);
  for (const [graphKey, graphQuads] of byGraph) {
    lines.push(`${graphKey} {`);
    lines.push(...statementLines(graphQuads, prefixes).map((l) => `  ${l}`));
    lines.push("}");
  }

  return lines.filter((line) => line.length > 0).join("\n") + "\n";
}

/**
 * statementLines renders quads grouped by subject, with `;` between predicate
 * groups and `,` between objects of the same predicate.
 */
function statementLines(
  quads: rdfjs.Quad[],
  prefixes: Record<string, string>,
): string[] {
  const bySubject = new Map<string, rdfjs.Quad[]>();
  for (const q of quads) {
    const key = term(q.subject, prefixes);
    const bucket = bySubject.get(key);
    if (bucket) {
      bucket.push(q);
    } else {
      bySubject.set(key, [q]);
    }
  }

  const lines: string[] = [];
  for (const [subjectKey, subjectQuads] of bySubject) {
    const byPredicate = new Map<string, rdfjs.Quad[]>();
    for (const q of subjectQuads) {
      const key = term(q.predicate, prefixes);
      const bucket = byPredicate.get(key);
      if (bucket) {
        bucket.push(q);
      } else {
        byPredicate.set(key, [q]);
      }
    }
    const predicateGroups: string[] = [];
    for (const [predicateKey, predicateQuads] of byPredicate) {
      predicateGroups.push(
        predicateKey +
          " " +
          predicateQuads.map((q) => term(q.object, prefixes)).join(", "),
      );
    }
    lines.push(subjectKey + " " + predicateGroups.join(" ;\n  ") + " .");
  }
  return lines;
}

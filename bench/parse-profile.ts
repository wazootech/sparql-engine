/**
 * parse-profile attributes the cost of the CLI load path (read, parse, index)
 * to its stages, in-process under Deno/V8, on the text `buildPeopleTurtle`
 * generates. It is the profiling step of issue #251: it changes no engine or
 * parser source. Stages are timed in interleaved rounds after warm-up, and
 * adjacent stages are subtracted to attribute cost:
 *
 *   read      file read and decode only
 *   lex       the generated Turtle lexer looped to end of input
 *   lexparse  lexer + LR driver with no-op semantic actions
 *   full      `parseTurtleQuads` (lexer + driver + real actions)
 *   index     `MemoryStore.addQuad` over pre-parsed quads
 *   keys      `termKey`/`quadKey` work alone (a sub-cost of index)
 *
 * Lex-only and no-op-action runs patch `LrParser.prototype.parse` from this
 * script; the generated lexer class is not exported, so this reuses the real
 * lexer instance the generated entry point builds.
 *
 * Usage: deno task bench:profile [--people 2000,10000] [--rounds 11]
 */
import { LR_EOF, LrLexer, LrParser } from "@/parser/lr-runtime.ts";
import { parseTurtleQuads } from "@/parser/turtle-parser.ts";
import type { RdfQuad } from "@/parser/rdf-terms.ts";
import { MemoryStore } from "@/store/memory-store.ts";
import { termKey } from "@/term/mod.ts";
import { buildPeopleTurtle } from "./cli-workloads.ts";
import { quantile, summarize } from "./cli-bench-stats.ts";

type ParseMode = "normal" | "lex-only" | "noop-actions";

let parseMode: ParseMode = "normal";
const originalParse = LrParser.prototype.parse;

LrParser.prototype.parse = function (
  this: LrParser<unknown>,
  lexer: LrLexer,
): void {
  if (parseMode === "lex-only") {
    while (lexer.lex() !== LR_EOF) { /* drain tokens */ }
    return;
  }
  if (parseMode === "noop-actions") {
    this.performAction = () => undefined;
  }
  originalParse.call(this, lexer);
};

function runWithMode(mode: ParseMode, text: string): void {
  parseMode = mode;
  try {
    parseTurtleQuads(text);
  } finally {
    parseMode = "normal";
  }
}

function argValue(name: string, fallback: string): string {
  const index = Deno.args.indexOf(name);
  return index >= 0 ? Deno.args[index + 1]! : fallback;
}

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

/** keyWork repeats the key building one `addQuad` does for each quad. */
function keyWork(quads: RdfQuad[]): number {
  let total = 0;
  for (const quad of quads) {
    total += [
      termKey(quad.subject),
      termKey(quad.predicate),
      termKey(quad.object),
      termKey(quad.graph),
    ].join("|").length;
    total += termKey(quad.subject).length + termKey(quad.predicate).length +
      termKey(quad.object).length + termKey(quad.graph).length;
  }
  return total;
}

/** countLexing runs the lexer once with RegExp exec and next() counted. */
function countLexing(text: string): {
  nextCalls: number;
  execCalls: number;
  tokens: number;
  characters: number;
} {
  let execCalls = 0;
  let nextCalls = 0;
  let tokens = 0;
  const originalExec = RegExp.prototype.exec;
  const originalNext = LrLexer.prototype.next;
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    execCalls++;
    return originalExec.call(this, input);
  };
  LrLexer.prototype.next = function (this: LrLexer) {
    nextCalls++;
    const token = originalNext.call(this);
    if (token !== 0) tokens++;
    return token;
  };
  try {
    runWithMode("lex-only", text);
  } finally {
    RegExp.prototype.exec = originalExec;
    LrLexer.prototype.next = originalNext;
  }
  return { nextCalls, execCalls, tokens, characters: text.length };
}

const peopleList = argValue("--people", "2000,10000").split(",").map(Number);
const rounds = Number(argValue("--rounds", "11"));
const warmups = 3;
const tempPath = await Deno.makeTempFile({ suffix: ".ttl" });

console.log(
  `# parse-profile: Deno ${Deno.version.deno} / V8 ${Deno.version.v8}, ` +
    `${Deno.build.os}-${Deno.build.arch}, ${rounds} rounds, ${warmups} warm-ups`,
);
console.log("# machine-specific numbers; compare ratios, not absolutes\n");

for (const people of peopleList) {
  const text = buildPeopleTurtle(people);
  await Deno.writeTextFile(tempPath, text);
  const preParsed = parseTurtleQuads(text);
  const stages: Record<string, () => void> = {
    read: () => void Deno.readTextFileSync(tempPath),
    lex: () => runWithMode("lex-only", text),
    lexparse: () => runWithMode("noop-actions", text),
    full: () => runWithMode("normal", text),
    index: () => {
      const store = new MemoryStore();
      for (const quad of preParsed) store.addQuad(quad);
    },
    keys: () => void keyWork(preParsed),
  };
  const names = Object.keys(stages);
  const samples: Record<string, number[]> = {};
  for (const name of names) {
    samples[name] = [];
    for (let warm = 0; warm < warmups; warm++) stages[name]!();
  }
  for (let round = 0; round < rounds; round++) {
    for (const name of names) {
      samples[name]!.push(milliseconds(stages[name]!));
    }
  }
  const stat = (name: string) => {
    const summary = summarize(samples[name]!);
    return {
      min: summary.minimum,
      median: summary.median,
      iqr: quantile([...samples[name]!].sort((a, b) => a - b), 0.75) -
        quantile([...samples[name]!].sort((a, b) => a - b), 0.25),
    };
  };
  const counts = countLexing(text);
  console.log(
    `## ${people} people: ${preParsed.length} quads, ${text.length} chars`,
  );
  console.log("stage     min ms  median ms  IQR ms");
  for (const name of names) {
    const s = stat(name);
    console.log(
      `${name.padEnd(9)} ${s.min.toFixed(1).padStart(6)}  ` +
        `${s.median.toFixed(1).padStart(9)}  ${s.iqr.toFixed(1).padStart(6)}`,
    );
  }
  const median = (name: string) => stat(name).median;
  const attribution: Array<[string, number]> = [
    ["read file", median("read")],
    ["lex (regex scanning)", median("lex")],
    ["LR driver (lexparse - lex)", median("lexparse") - median("lex")],
    ["semantic actions (full - lexparse)", median("full") - median("lexparse")],
    ["index addQuad", median("index")],
  ];
  const total = attribution.reduce((sum, [, value]) => sum + value, 0);
  console.log("\nattribution (medians; total = read + full + index)");
  for (const [label, value] of attribution) {
    console.log(
      `${label.padEnd(36)} ${value.toFixed(1).padStart(8)} ms ` +
        `${((value / total) * 100).toFixed(1).padStart(5)}%`,
    );
  }
  console.log(`total${" ".repeat(31)} ${total.toFixed(1).padStart(8)} ms`);
  console.log(
    `  of which keys alone (inside index): ${median("keys").toFixed(1)} ms ` +
      `(${((median("keys") / median("index")) * 100).toFixed(0)}% of index)`,
  );
  console.log(
    `lexer: ${counts.tokens} tokens, ${counts.nextCalls} next() calls, ` +
      `${counts.execCalls} exec calls = ` +
      `${(counts.execCalls / counts.nextCalls).toFixed(1)} per next(), ` +
      `${(counts.execCalls / counts.tokens).toFixed(1)} per token\n`,
  );
}
await Deno.remove(tempPath);

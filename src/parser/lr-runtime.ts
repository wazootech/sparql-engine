/**
 * Typed LR parsing runtime shared by the generated parsers.
 *
 * `generate-parser.ts` uses jison only as a table generator (the grammar, the
 * SLR tables, the lexer regular expressions) and emits a module that extends
 * the two classes below: `LrLexer` supplies the lexer loop, `LrParser` the LR
 * driver. Neither uses `arguments`, `Object.create`, `apply`, or untyped
 * expando properties, so the generated module type-checks under `strict` (and
 * can be analysed by scriptc, issue #221).
 *
 * Error messages and `hash` payloads keep jison's shape (`Parse error on line
 * N:`, `Lexical error on line N.`), so consumers such as
 * `toSparqlSyntaxError` can read them unchanged.
 */

/** LR_EOF is the token id the lexer returns at the end of input. */
export const LR_EOF = 1;

/** LrLocation is a source span (1-based lines, 0-based columns). */
export interface LrLocation {
  firstLine: number;
  lastLine: number;
  firstColumn: number;
  lastColumn: number;
}

/** LrParseErrorHash is the structured payload attached to an LR error. */
export interface LrParseErrorHash {
  /** The text matched at the error ("" for lexical errors). */
  text: string;
  /** The offending token name (null for lexical errors). */
  token: string | null;
  /** The 0-based line of the lexer when the error was raised. */
  line: number;
  /** The span of the last shifted token (null for lexical errors). */
  loc: LrLocation | null;
  /** The quoted token names the parser was expecting. */
  expected: string[];
}

/** LrParseError is thrown for lexical and parse failures, with a `hash`. */
export class LrParseError extends Error {
  readonly hash: LrParseErrorHash;

  public constructor(message: string, hash: LrParseErrorHash) {
    super(message);
    this.hash = hash;
  }
}

/**
 * LrTables is the data half of a generated parser. A table cell is a pair
 * `[kind, argument]`: `[1, state]` shifts, `[2, production]` reduces,
 * `[3]` accepts.
 */
export interface LrTables {
  /** Terminal names by token id (the `$end` token is unnamed). */
  terminalNames: Record<number, string>;
  /** The left-hand-side symbol id of each production. */
  productionSymbols: number[];
  /** The right-hand-side length of each production. */
  productionLengths: number[];
  /** Per state: lookahead token id to action cell. */
  actions: Array<Record<number, number[]>>;
  /** Per state: nonterminal symbol id to next state. */
  gotos: Array<Record<number, number>>;
  /** States whose action does not need a lookahead. */
  defaultActions: Record<number, number[]>;
}

const SHIFT = 1;
const REDUCE = 2;

/**
 * LrLexer is the lexer loop: the longest match among `rules` wins (earlier
 * rules win ties, jison's `flex` option), the matched rule's index goes to
 * `performAction`, which returns the token id, or 0 to skip the text
 * (whitespace and comments).
 */
export class LrLexer {
  /** The full input text. */
  readonly input: string;
  /** The offset of the first unconsumed character. */
  offset = 0;
  /** The text of the most recent token. */
  yytext = "";
  /** The text matched by the most recent call to `next`. */
  match = "";
  /** The 0-based line of the end of the most recent token. */
  yylineno = 0;
  /** The span of the most recent token. */
  yylloc: LrLocation = {
    firstLine: 1,
    lastLine: 1,
    firstColumn: 0,
    lastColumn: 0,
  };
  private done = false;
  private readonly rules: readonly RegExp[];

  public constructor(input: string, rules: readonly RegExp[]) {
    this.input = input;
    this.rules = rules;
  }

  /** performAction returns the token id for a matched rule (0 skips it). */
  performAction(rule: number): number {
    throw new Error(
      "LrLexer.performAction is not implemented for rule " + rule,
    );
  }

  /** lex returns the id of the next token, skipping ignored text. */
  lex(): number {
    for (;;) {
      const token = this.next();
      if (token !== 0) {
        return token;
      }
    }
  }

  /** next matches one rule at the current offset (0 for an ignored match). */
  next(): number {
    if (this.done) {
      return LR_EOF;
    }
    if (this.offset >= this.input.length) {
      this.done = true;
    }
    this.yytext = "";
    this.match = "";
    const rest = this.input.slice(this.offset);
    let best: RegExpMatchArray | null = null;
    let bestRule = -1;
    for (let rule = 0; rule < this.rules.length; rule++) {
      const candidate = rest.match(this.rules[rule]!);
      if (
        candidate !== null &&
        (best === null || candidate[0].length > best[0].length)
      ) {
        best = candidate;
        bestRule = rule;
      }
    }
    if (best !== null) {
      return this.accept(best[0], bestRule);
    }
    if (rest === "") {
      return LR_EOF;
    }
    throw new LrParseError(
      "Lexical error on line " + (this.yylineno + 1) +
        ". Unrecognized text.\n" + this.showPosition(),
      { text: "", token: null, line: this.yylineno, loc: null, expected: [] },
    );
  }

  private accept(text: string, rule: number): number {
    let lines: RegExpMatchArray | null = null;
    if (text.indexOf("\n") >= 0 || text.indexOf("\r") >= 0) {
      lines = text.match(/(?:\r\n?|\n).*/g);
    }
    if (lines !== null) {
      this.yylineno += lines.length;
    }
    const previous = this.yylloc;
    let lastColumn = previous.lastColumn + text.length;
    if (lines !== null) {
      const lastLine = lines[lines.length - 1]!;
      const lineBreak = lastLine.match(/\r?\n?/);
      lastColumn = lastLine.length -
        (lineBreak === null ? 0 : lineBreak[0].length);
    }
    this.yylloc = {
      firstLine: previous.lastLine,
      lastLine: this.yylineno + 1,
      firstColumn: previous.lastColumn,
      lastColumn,
    };
    this.yytext = text;
    this.match = text;
    this.offset += text.length;
    return this.performAction(rule);
  }

  /** pastInput returns up to 20 characters consumed before the current token. */
  pastInput(): string {
    const past = this.input.slice(0, this.offset - this.match.length);
    return (past.length > 20 ? "..." : "") +
      past.slice(-20).replace(/\n/g, "");
  }

  /** upcomingInput returns up to 20 characters from the current token on. */
  upcomingInput(): string {
    let upcoming = this.match;
    if (upcoming.length < 20) {
      upcoming += this.input.slice(
        this.offset,
        this.offset + 20 -
          upcoming.length,
      );
    }
    return (upcoming.slice(0, 20) + (upcoming.length > 20 ? "..." : ""))
      .replace(/\n/g, "");
  }

  /** showPosition renders the input around the error with a caret line. */
  showPosition(): string {
    const before = this.pastInput();
    return before + this.upcomingInput() + "\n" + "-".repeat(before.length) +
      "^";
  }
}

/**
 * LrParser is the LR driver. A generated subclass supplies the semantic
 * actions: `performAction` receives the production number and the value
 * stack (the right-hand-side values are its last entries) and returns the
 * production's value.
 */
export class LrParser<Value> {
  private readonly tables: LrTables;

  public constructor(tables: LrTables) {
    this.tables = tables;
  }

  /** tokenValue is the semantic value of a shifted token with this text. */
  tokenValue(text: string): Value {
    throw new Error("LrParser.tokenValue is not implemented for " + text);
  }

  /** performAction runs the semantic action of a reduced production. */
  performAction(production: number, values: Value[]): Value {
    throw new Error(
      "LrParser.performAction is not implemented for production " + production +
        " (" + values.length + " values)",
    );
  }

  /** parse runs the automaton over the lexer's tokens, throwing on error. */
  parse(lexer: LrLexer): void {
    const tables = this.tables;
    const states: number[] = [0];
    const values: Value[] = [this.tokenValue("")];
    const locations: LrLocation[] = [lexer.yylloc];
    let lineNumber = 0;
    let location = lexer.yylloc;
    let symbol = 0;
    let hasSymbol = false;
    for (;;) {
      const state = states[states.length - 1]!;
      let action: number[] | undefined = tables.defaultActions[state];
      if (action === undefined) {
        if (!hasSymbol) {
          symbol = lexer.lex();
          hasSymbol = true;
        }
        action = tables.actions[state]![symbol];
      }
      if (action === undefined || action.length === 0 || action[0] === 0) {
        throw this.syntaxError(lexer, state, symbol, lineNumber, location);
      }
      const kind = action[0];
      if (kind === SHIFT) {
        states.push(action[1]!);
        values.push(this.tokenValue(lexer.yytext));
        locations.push(lexer.yylloc);
        hasSymbol = false;
        lineNumber = lexer.yylineno;
        location = lexer.yylloc;
      } else if (kind === REDUCE) {
        const production = action[1]!;
        const length = tables.productionLengths[production]!;
        const value = this.performAction(production, values);
        const first = locations[locations.length - (length || 1)]!;
        const last = locations[locations.length - 1]!;
        const span: LrLocation = {
          firstLine: first.firstLine,
          lastLine: last.lastLine,
          firstColumn: first.firstColumn,
          lastColumn: last.lastColumn,
        };
        for (let popped = 0; popped < length; popped++) {
          states.pop();
          values.pop();
          locations.pop();
        }
        values.push(value);
        locations.push(span);
        const exposed = states[states.length - 1]!;
        states.push(
          tables.gotos[exposed]![tables.productionSymbols[production]!]!,
        );
      } else {
        return;
      }
    }
  }

  private syntaxError(
    lexer: LrLexer,
    state: number,
    symbol: number,
    lineNumber: number,
    location: LrLocation,
  ): LrParseError {
    const names = this.tables.terminalNames;
    const expected: string[] = [];
    const row = this.tables.actions[state]!;
    const keys = Object.keys(row);
    for (let index = 0; index < keys.length; index++) {
      const token = Number(keys[index]);
      const name = names[token];
      if (name !== undefined && token > 2) {
        expected.push("'" + name + "'");
      }
    }
    const tokenName = names[symbol] ?? String(symbol);
    return new LrParseError(
      "Parse error on line " + (lineNumber + 1) + ":\n" +
        lexer.showPosition() + "\nExpecting " + expected.join(", ") +
        ", got '" + tokenName + "'",
      {
        text: lexer.match,
        token: tokenName,
        line: lexer.yylineno,
        loc: location,
        expected,
      },
    );
  }
}

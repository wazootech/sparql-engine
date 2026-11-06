/**
 * First-character dispatch for `LrLexer`.
 *
 * The lexer must pick the longest match among every rule, but a rule can only
 * match at an offset whose character is one the rule can begin with. This
 * module reads each rule's source once and records which ASCII characters can
 * begin it, so `next()` runs only those rules instead of all of them.
 *
 * The analysis is conservative: whenever it cannot prove a rule's first
 * character (a lookahead, a backreference, an anchor, a unicode-mode flag, or
 * a pattern that can match the empty string) the rule joins the fallback set
 * and is tried for every character, in its original position. Candidate lists
 * keep rule order, so longest-match-wins and earlier-rule-wins-ties are
 * unchanged.
 */

/** LexerDispatch holds the candidate rule indexes for each kind of next char. */
export interface LexerDispatch {
  /** Candidate rule indexes per ASCII char code (length 128), in rule order. */
  readonly ascii: ReadonlyArray<readonly number[]>;
  /** Candidate rule indexes for any char code of 128 or more. */
  readonly high: readonly number[];
  /** Candidate rule indexes at the end of input (rules that can match empty). */
  readonly end: readonly number[];
}

const ASCII_COUNT = 128;

interface FirstSet {
  ascii: boolean[];
  high: boolean;
  nullable: boolean;
}

interface ScanState {
  source: string;
  flags: string;
  position: number;
  supported: boolean;
}

function emptyFirst(nullable: boolean): FirstSet {
  const ascii: boolean[] = [];
  for (let code = 0; code < ASCII_COUNT; code++) {
    ascii.push(false);
  }
  return { ascii, high: false, nullable };
}

function mergeFirst(target: FirstSet, other: FirstSet): void {
  for (let code = 0; code < ASCII_COUNT; code++) {
    if (other.ascii[code]) {
      target.ascii[code] = true;
    }
  }
  if (other.high) {
    target.high = true;
  }
}

/** atomFirst computes which ASCII chars one atom matches by testing the atom. */
function atomFirst(state: ScanState, start: number, high: boolean): FirstSet {
  const first = emptyFirst(false);
  const matcher = new RegExp(
    "^(?:" + state.source.slice(start, state.position) + ")$",
    state.flags,
  );
  for (let code = 0; code < ASCII_COUNT; code++) {
    first.ascii[code] = matcher.test(String.fromCharCode(code));
  }
  first.high = high || state.flags.includes("i");
  return first;
}

function isHexDigits(text: string): boolean {
  return /^[0-9A-Fa-f]+$/.test(text);
}

/** scanEscape handles a backslash atom; returns whether it may match 128+. */
function scanEscape(state: ScanState): boolean {
  const kind = state.source.charAt(state.position + 1);
  state.position += 2;
  if ("SWDHs".includes(kind) || kind === "") {
    return true;
  }
  if ("dwtnrfv0".includes(kind)) {
    return false;
  }
  const digits = kind === "x" ? 2 : kind === "u" ? 4 : 0;
  if (digits > 0) {
    const text = state.source.slice(state.position, state.position + digits);
    if (text.length !== digits || !isHexDigits(text)) {
      state.supported = false;
      return true;
    }
    state.position += digits;
    return parseInt(text, 16) >= ASCII_COUNT;
  }
  if (/[A-Za-z0-9]/.test(kind)) {
    state.supported = false;
  }
  return false;
}

/** scanClass handles `[...]`; the class may match 128+ unless plain ASCII. */
function scanClass(state: ScanState): boolean {
  let high = state.source.charAt(state.position + 1) === "^";
  state.position++;
  for (;;) {
    if (state.position >= state.source.length) {
      state.supported = false;
      return true;
    }
    const char = state.source.charAt(state.position);
    if (char === "]") {
      state.position++;
      return high;
    }
    if (char === "\\" || char.charCodeAt(0) >= ASCII_COUNT) {
      high = true;
    }
    state.position += char === "\\" ? 2 : 1;
  }
}

function scanAtom(state: ScanState): FirstSet {
  const start = state.position;
  const char = state.source.charAt(start);
  if (char === "(") {
    state.position++;
    if (state.source.charAt(state.position) === "?") {
      if (state.source.charAt(state.position + 1) !== ":") {
        state.supported = false;
      }
      state.position += 2;
    }
    const inner = scanAlternation(state);
    if (state.source.charAt(state.position) !== ")") {
      state.supported = false;
    }
    state.position++;
    return inner;
  }
  if (char === "^" || char === "$") {
    state.supported = false;
    state.position++;
    return emptyFirst(true);
  }
  let high = false;
  if (char === "[") {
    high = scanClass(state);
  } else if (char === "\\") {
    high = scanEscape(state);
  } else {
    state.position++;
    high = char === "." || char.charCodeAt(0) >= ASCII_COUNT;
  }
  return atomFirst(state, start, high);
}

/** scanQuantifier makes the atom nullable for `*`, `?` and `{0,...}`. */
function scanQuantifier(state: ScanState, atom: FirstSet): void {
  const char = state.source.charAt(state.position);
  if (char === "*" || char === "?") {
    atom.nullable = true;
    state.position++;
  } else if (char === "+") {
    state.position++;
  } else if (char === "{") {
    const close = state.source.indexOf("}", state.position);
    const range = state.source.slice(state.position + 1, close);
    if (close < 0 || !/^[0-9]+(,[0-9]*)?$/.test(range)) {
      state.supported = false;
      return;
    }
    if (parseInt(range, 10) === 0) {
      atom.nullable = true;
    }
    state.position = close + 1;
  } else {
    return;
  }
  if (state.source.charAt(state.position) === "?") {
    state.position++;
  }
}

function scanSequence(state: ScanState): FirstSet {
  const sequence = emptyFirst(true);
  while (state.supported && state.position < state.source.length) {
    const char = state.source.charAt(state.position);
    if (char === "|" || char === ")") {
      break;
    }
    const atom = scanAtom(state);
    scanQuantifier(state, atom);
    if (sequence.nullable) {
      mergeFirst(sequence, atom);
    }
    sequence.nullable = sequence.nullable && atom.nullable;
  }
  return sequence;
}

function scanAlternation(state: ScanState): FirstSet {
  const union = scanSequence(state);
  while (state.supported && state.source.charAt(state.position) === "|") {
    state.position++;
    const branch = scanSequence(state);
    mergeFirst(union, branch);
    union.nullable = union.nullable || branch.nullable;
  }
  return union;
}

/**
 * firstCharacters returns the chars a rule can begin with, or null when it
 * cannot be determined statically or the rule can match the empty string.
 */
function firstCharacters(rule: RegExp): FirstSet | null {
  const flags = rule.flags.replaceAll("g", "").replaceAll("y", "");
  if (flags.includes("u") || flags.includes("v") || flags.includes("m")) {
    return null;
  }
  const source = rule.source.startsWith("^")
    ? rule.source.slice(1)
    : rule.source;
  const state: ScanState = { source, flags, position: 0, supported: true };
  const first = scanAlternation(state);
  if (
    !state.supported || state.position !== source.length || first.nullable
  ) {
    return null;
  }
  return first;
}

/**
 * buildLexerDispatch computes the candidate rule table for `rules`. With
 * `exhaustive`, every list holds every rule: the reference strategy the
 * dispatching one must match token for token.
 */
export function buildLexerDispatch(
  rules: readonly RegExp[],
  exhaustive: boolean,
): LexerDispatch {
  const firsts = rules.map((rule) => exhaustive ? null : firstCharacters(rule));
  const ascii: number[][] = [];
  for (let code = 0; code < ASCII_COUNT; code++) {
    ascii.push([]);
  }
  const high: number[] = [];
  const end: number[] = [];
  firsts.forEach((first, index) => {
    if (first === null) {
      end.push(index);
      high.push(index);
      for (let code = 0; code < ASCII_COUNT; code++) {
        ascii[code]!.push(index);
      }
      return;
    }
    if (first.high) {
      high.push(index);
    }
    for (let code = 0; code < ASCII_COUNT; code++) {
      if (first.ascii[code]) {
        ascii[code]!.push(index);
      }
    }
  });
  return { ascii, high, end };
}

/**
 * escapeIri escapes a value for use inside `<...>` (IRIREF grammar). The
 * grammar only permits `\u`/`\U` escapes inside an IRI (a literal backslash
 * is excluded), so every forbidden character is emitted as a UCHAR rather
 * than a backslash-escaped form.
 */
export function escapeIri(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (
      ch === "\\" ||
      ch === ">" ||
      ch === "<" ||
      ch === '"' ||
      ch === "{" ||
      ch === "}" ||
      ch === "|" ||
      ch === "^" ||
      ch === "`" ||
      code <= 0x20
    ) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** escapeLiteral escapes a literal value for use inside `"..."` (STRING_LITERAL_QUOTE grammar). */
export function escapeLiteral(value: string): string {
  let out = "";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = ch.codePointAt(0)!;
        out += code <= 0x1f ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
      }
    }
  }
  return out;
}

/** LABEL_START matches a character a blank node label may begin with: PN_CHARS_U or a digit. */
const LABEL_START: RegExp =
  /^[A-Za-z0-9_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]$/u;

/** LABEL_TAIL_ONLY matches the PN_CHARS a label may contain but not begin with. */
const LABEL_TAIL_ONLY: RegExp = /^[\u0300-\u036F\u203F\u2040-]$/u;

/**
 * escapeBlankNodeLabel escapes a blank node label for the BLANK_NODE_LABEL
 * grammar, hex-encoding a character the grammar does not allow at that position
 * the same way the reference implementations do (`_xHH_`). A label may not start
 * with "-" or ".", nor end with ".". A dot right after a dot is encoded too:
 * the grammar allows it, but n3 does not read it.
 */
export function escapeBlankNodeLabel(value: string): string {
  let out = "";
  let offset = 0;
  let afterDot = false;
  for (const ch of value) {
    const first = offset === 0;
    offset += ch.length;
    const safe: boolean =
      LABEL_START.test(ch) ||
      (!first && LABEL_TAIL_ONLY.test(ch)) ||
      (!first && !afterDot && offset < value.length && ch === ".");
    afterDot = safe && ch === ".";
    const code = ch.codePointAt(0)!;
    out += safe ? ch : `_x${code.toString(16).toUpperCase().padStart(2, "0")}_`;
  }
  return out;
}

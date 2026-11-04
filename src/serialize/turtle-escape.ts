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
      ch === "\\" || ch === ">" || ch === "<" || ch === '"' || ch === "{" ||
      ch === "}" || ch === "|" || ch === "^" || ch === "`" || code <= 0x20
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

/**
 * escapeBlankNodeLabel escapes a blank node label for the `_:label` grammar
 * (PN_CHARS_U / PN_CHARS), hex-encoding characters outside the safe set the
 * same way the reference implementations do (`_xHH_`).
 */
export function escapeBlankNodeLabel(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const safe = /[A-Za-z0-9_\u00C0-\uFFFF.-]/.test(ch);
    out += safe ? ch : `_x${code.toString(16).toUpperCase().padStart(2, "0")}_`;
  }
  return out;
}

/**
 * encodeForUri implements fn:encode-for-uri (XPath F&O 3.1 §6.2.2, the
 * function SPARQL's ENCODE_FOR_URI delegates to): every UTF-8 byte is
 * percent-encoded except the unreserved characters `A-Z a-z 0-9 - _ . ~`.
 * `encodeURIComponent` already does that except for `! ' ( ) *`, which it
 * leaves alone, so those five are encoded by hand. Returns undefined for a
 * string with a lone surrogate (not encodable as UTF-8): an evaluation error.
 */
export function encodeForUri(value: string): string | undefined {
  try {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    return undefined;
  }
}

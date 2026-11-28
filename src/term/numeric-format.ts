/**
 * numeric-format.ts renders numeric values as lexical forms.
 */

/**
 * formatNumber renders a numeric value's Number string form. No datatype
 * padding is applied: like Comunica, decimal results use plain JS string
 * forms (6/3 -> "2", not "2.0"). Double and float results keep the Number
 * string form; canonicalDouble (used by the XSD constructors and the
 * aggregates) produces the canonical XPath exponent form instead. Infinity and
 * NaN take their XML Schema spellings.
 */
export function formatNumber(value: number, _datatype: string): string {
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? "INF" : "-INF";
  }
  return String(value);
}

/**
 * canonicalDouble renders a number in the canonical XPath double lexical
 * form: a mantissa with at least one decimal digit and an exponent with no
 * leading plus ("3.0E0", "1.5E0", "1.0E21", "INF", "-INF").
 */
export function canonicalDouble(n: number): string {
  if (Number.isNaN(n)) {
    return "NaN";
  }
  if (n === 0) {
    return "0.0E0";
  }
  if (!Number.isFinite(n)) {
    return n > 0 ? "INF" : "-INF";
  }
  const [mantissa, exponent] = n.toExponential().split("e");
  const mantissaFixed = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
  const exponentText = exponent.startsWith("+") ? exponent.slice(1) : exponent;
  return `${mantissaFixed}E${exponentText}`;
}

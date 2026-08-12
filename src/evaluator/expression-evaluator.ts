import type * as rdfjs from "@rdfjs/types";
import type {
  Expression,
  FunctionCallExpression,
  OperationExpression,
  Term as SparqlTerm,
} from "sparqljs";
import { DataFactory } from "n3";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import {
  compareNumericValues,
  formatNumber,
  NUMERIC_DATATYPES,
  numericValue,
  sameRdfTerm,
  sparqlTermToRdfTerm,
  XSD_BOOLEAN,
  XSD_DECIMAL,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_INTEGER,
  XSD_STRING,
} from "@/term/mod.ts";

const { literal, namedNode } = DataFactory;

/**
 * Ebv is the effective boolean value of a term: true, false, or "error"
 * (unbound, type error, or a term whose EBV is undefined per SPARQL 1.1).
 */
type Ebv = boolean | "error";

/**
 * ExpressionEvaluator evaluates SPARQL 1.1 expression ASTs against a solution
 * binding, producing RDF/JS terms or undefined for unbound variables and
 * runtime type errors. It is shared by FILTER (via BgpEvaluator) and ORDER BY
 * (via SparqlEvaluator); both treat undefined the same way — FILTER drops the
 * binding, ORDER BY sorts it lowest.
 *
 * Supported surface: comparisons (=, !=, <, >, <=, >=), logicals (&&, ||, !),
 * arithmetic (+, -, *, / with numeric datatype promotion and integer-exact
 * BigInt results), bound(), STR(), STRLEN(), the string functions UCASE,
 * LCASE, CONCAT, and SUBSTR, the datatype constructors STRDT and STRLANG,
 * and the XSD value constructors (xsd:integer/decimal/double/float/string/
 * boolean). Unsupported expression kinds (aggregates, IN tuples, other
 * function calls) raise a clear error.
 */
export class ExpressionEvaluator {
  /**
   * evaluate resolves an expression against a binding. Returns undefined for
   * unbound variables and runtime errors (type errors, division by zero).
   */
  public evaluate(
    expression: Expression,
    binding: TermBinding,
  ): rdfjs.Term | undefined {
    if ("termType" in expression) {
      if (expression.termType === "Variable") {
        return binding[expression.value];
      }
      return sparqlTermToRdfTerm(expression as SparqlTerm);
    }
    if (!("type" in expression)) {
      throw new Error("Unsupported SPARQL expression: tuple");
    }
    if (expression.type === "functionCall") {
      return this.evaluateFunctionCall(expression, binding);
    }
    if (expression.type !== "operation") {
      throw new Error(`Unsupported SPARQL expression: ${expression.type}`);
    }
    return this.evaluateOperation(expression, binding);
  }

  /**
   * filterPasses is true exactly when the expression's EBV is true; used by
   * FILTER, where errors and false values both drop the binding.
   */
  public filterPasses(
    expression: Expression,
    binding: TermBinding,
  ): boolean {
    return this.ebv(this.evaluate(expression, binding)) === true;
  }

  private evaluateOperation(
    operation: OperationExpression,
    binding: TermBinding,
  ): rdfjs.Term | undefined {
    const arg = (index: number): Expression =>
      operation.args[index] as Expression;
    switch (operation.operator) {
      case "&&":
      case "||": {
        const left = this.ebv(this.evaluate(arg(0), binding));
        const right = this.ebv(this.evaluate(arg(1), binding));
        if (operation.operator === "&&") {
          if (left === false || right === false) {
            return booleanLiteral(false);
          }
          if (left === "error" || right === "error") {
            return undefined;
          }
          return booleanLiteral(true);
        }
        if (left === true || right === true) {
          return booleanLiteral(true);
        }
        if (left === "error" || right === "error") {
          return undefined;
        }
        return booleanLiteral(false);
      }
      case "!": {
        const value = this.ebv(this.evaluate(arg(0), binding));
        return value === "error" ? undefined : booleanLiteral(!value);
      }
      case "=":
      case "!=":
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const a = this.evaluate(arg(0), binding);
        const b = this.evaluate(arg(1), binding);
        if (a === undefined || b === undefined) {
          return undefined;
        }
        if (operation.operator === "=" || operation.operator === "!=") {
          const equal = this.valuesEqual(a, b);
          return booleanLiteral(operation.operator === "=" ? equal : !equal);
        }
        const comparison = this.orderValues(a, b);
        if (comparison === "error") {
          return undefined;
        }
        switch (operation.operator) {
          case "<":
            return booleanLiteral(comparison < 0);
          case ">":
            return booleanLiteral(comparison > 0);
          case "<=":
            return booleanLiteral(comparison <= 0);
          case ">=":
            return booleanLiteral(comparison >= 0);
        }
        return undefined;
      }
      case "+":
      case "-":
      case "*":
      case "/": {
        if (operation.args.length === 1 && operation.operator === "-") {
          return this.unaryMinus(arg(0), binding);
        }
        const a = this.evaluate(arg(0), binding);
        const b = this.evaluate(arg(1), binding);
        if (a === undefined || b === undefined) {
          return undefined;
        }
        if (a.termType !== "Literal" || b.termType !== "Literal") {
          return undefined;
        }
        return this.arithmetic(operation.operator, a, b);
      }
      case "bound": {
        const boundArg = arg(0);
        if (!("termType" in boundArg) || boundArg.termType !== "Variable") {
          return undefined;
        }
        return booleanLiteral(binding[boundArg.value] !== undefined);
      }
      case "str":
        return this.str(this.evaluate(arg(0), binding));
      case "strlen": {
        const value = this.evaluate(arg(0), binding);
        if (
          value === undefined || value.termType !== "Literal" ||
          !this.isStringTyped(value)
        ) {
          return undefined;
        }
        return literal(String(value.value.length), namedNode(XSD_INTEGER));
      }
      case "ucase":
      case "lcase":
        return this.stringCase(operation.operator, arg(0), binding);
      case "concat":
        return this.concat(operation.args as Expression[], binding);
      case "substr":
        return this.substr(operation.args as Expression[], binding);
      case "strdt":
        return this.strdt(operation.args as Expression[], binding);
      case "strlang":
        return this.strlang(operation.args as Expression[], binding);
      default:
        throw new Error(
          `Unsupported SPARQL expression operator: ${operation.operator}`,
        );
    }
  }

  /**
   * valuesEqual compares two terms with SPARQL `=` semantics: numeric
   * literals compare by value across numeric datatypes, string literals
   * compare by value (simple literals and xsd:string are interchangeable;
   * lang-tagged literals additionally require the same language), and
   * everything else compares as RDF terms.
   */
  private valuesEqual(a: rdfjs.Term, b: rdfjs.Term): boolean {
    if (a.termType !== "Literal" || b.termType !== "Literal") {
      return sameRdfTerm(a, b);
    }
    const an = numericValue(a);
    const bn = numericValue(b);
    if (an !== null && bn !== null) {
      if (typeof an === "bigint" && typeof bn === "bigint") {
        return an === bn;
      }
      return Number(an) === Number(bn);
    }
    const aString = this.isStringTyped(a);
    const bString = this.isStringTyped(b);
    if (aString && bString) {
      const aLang = a.language !== undefined && a.language !== "";
      const bLang = b.language !== undefined && b.language !== "";
      if (aLang || bLang) {
        return aLang && bLang && a.value === b.value &&
          a.language === b.language;
      }
      return a.value === b.value;
    }
    return false;
  }

  /**
   * orderValues compares two terms for `<`/`>`: numeric values numerically,
   * plain and xsd:string literals lexically, and lang-tagged literals or any
   * other combination as a type error (matching SPARQL 1.1 and Comunica).
   */
  private orderValues(a: rdfjs.Term, b: rdfjs.Term): number | "error" {
    if (a.termType !== "Literal" || b.termType !== "Literal") {
      return "error";
    }
    if (this.isLangTagged(a) || this.isLangTagged(b)) {
      return "error";
    }
    const an = numericValue(a);
    const bn = numericValue(b);
    if (an !== null && bn !== null) {
      return compareNumericValues(an, bn);
    }
    if (this.isStringTyped(a) && this.isStringTyped(b)) {
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    }
    return "error";
  }

  /**
   * arithmetic evaluates +, -, *, / with numeric datatype promotion:
   * integer op integer stays exact via BigInt (except division, which yields
   * a decimal per SPARQL 1.1); float/double promote the result; any other
   * combination is decimal. Division by zero is an error.
   */
  private arithmetic(
    operator: "+" | "-" | "*" | "/",
    a: rdfjs.Literal,
    b: rdfjs.Literal,
  ): rdfjs.Literal | undefined {
    const an = numericValue(a);
    const bn = numericValue(b);
    if (an === null || bn === null) {
      return undefined;
    }
    const da = a.datatype?.value;
    const db = b.datatype?.value;
    if (
      operator !== "/" &&
      da === XSD_INTEGER && db === XSD_INTEGER &&
      typeof an === "bigint" && typeof bn === "bigint"
    ) {
      let result: bigint;
      if (operator === "+") {
        result = an + bn;
      } else if (operator === "-") {
        result = an - bn;
      } else {
        result = an * bn;
      }
      return literal(result.toString(), namedNode(XSD_INTEGER));
    }
    const av = Number(an);
    const bv = Number(bn);
    let result: number;
    if (operator === "+") {
      result = av + bv;
    } else if (operator === "-") {
      result = av - bv;
    } else if (operator === "*") {
      result = av * bv;
    } else {
      if (bv === 0) {
        return undefined;
      }
      result = av / bv;
    }
    if (!Number.isFinite(result)) {
      return undefined;
    }
    let datatype = XSD_DECIMAL;
    if (da === XSD_DOUBLE || db === XSD_DOUBLE) {
      datatype = XSD_DOUBLE;
    } else if (da === XSD_FLOAT || db === XSD_FLOAT) {
      datatype = XSD_FLOAT;
    }
    return literal(formatNumber(result, datatype), namedNode(datatype));
  }

  private unaryMinus(
    expression: Expression,
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    const value = this.evaluate(expression, binding);
    if (value === undefined || value.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    const datatype = value.datatype?.value ?? XSD_INTEGER;
    if (typeof numeric === "bigint") {
      return literal((-numeric).toString(), namedNode(XSD_INTEGER));
    }
    return literal(
      formatNumber(-numeric, datatype),
      namedNode(datatype),
    );
  }

  /**
   * str implements STR(): strings and lang-tagged literals strip to a plain
   * literal of the lexical form, IRIs and blank nodes become their value, and
   * numeric literals become their canonical lexical form.
   */
  private str(value: rdfjs.Term | undefined): rdfjs.Literal | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value.termType === "Literal") {
      const datatype = value.datatype?.value;
      if (this.isStringTyped(value)) {
        return literal(value.value);
      }
      if (NUMERIC_DATATYPES.has(datatype ?? "")) {
        const numeric = numericValue(value);
        if (numeric === null) {
          return undefined;
        }
        return literal(formatNumber(Number(numeric), datatype ?? XSD_DECIMAL));
      }
      return undefined;
    }
    if (value.termType === "NamedNode" || value.termType === "BlankNode") {
      return literal(value.value);
    }
    return undefined;
  }

  private isStringTyped(literalTerm: rdfjs.Literal): boolean {
    const datatype = literalTerm.datatype?.value;
    return datatype === undefined || datatype === XSD_STRING ||
      literalTerm.language !== undefined && literalTerm.language !== "";
  }

  private isLangTagged(literalTerm: rdfjs.Literal): boolean {
    return literalTerm.language !== undefined && literalTerm.language !== "";
  }

  /**
   * stringCase implements UCASE and LCASE: language-tagged inputs keep
   * their language, everything else becomes an xsd:string literal, and any
   * non-string input is a type error.
   */
  private stringCase(
    operator: "ucase" | "lcase",
    expression: Expression,
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    const value = this.evaluate(expression, binding);
    if (
      value === undefined || value.termType !== "Literal" ||
      !this.isStringTyped(value)
    ) {
      return undefined;
    }
    const transformed = operator === "ucase"
      ? value.value.toUpperCase()
      : value.value.toLowerCase();
    return this.stringResult(
      transformed,
      this.isLangTagged(value) ? value.language : undefined,
    );
  }

  /**
   * concat implements CONCAT over string literals; any non-string argument
   * (numeric literal, IRI, unbound) is a type error.
   */
  private concat(
    expressions: Expression[],
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    let result = "";
    for (const expression of expressions) {
      const value = this.evaluate(expression, binding);
      if (
        value === undefined || value.termType !== "Literal" ||
        !this.isStringTyped(value)
      ) {
        return undefined;
      }
      result += value.value;
    }
    return literal(result, namedNode(XSD_STRING));
  }

  /**
   * substr implements SUBSTR with XPath semantics for integer positions:
   * 1-based start, optional length, positions before 1 clipped, a negative
   * or zero length yielding the empty string. Non-integer positions are a
   * type error, matching the reference engines.
   */
  private substr(
    expressions: Expression[],
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    if (expressions.length < 2 || expressions.length > 3) {
      return undefined;
    }
    const str = this.evaluate(expressions[0], binding);
    const startTerm = this.evaluate(expressions[1], binding);
    const lenTerm = expressions.length === 3
      ? this.evaluate(expressions[2], binding)
      : undefined;
    if (
      str === undefined || startTerm === undefined ||
      str.termType !== "Literal" || !this.isStringTyped(str)
    ) {
      return undefined;
    }
    const start = this.integerValue(startTerm);
    if (start === null) {
      return undefined;
    }
    const length = lenTerm === undefined ? null : this.integerValue(lenTerm);
    if (lenTerm !== undefined && length === null) {
      return undefined;
    }
    const end = length === null ? Number.POSITIVE_INFINITY : start + length;
    const from = Math.max(start, 1) - 1;
    const to = end - 1;
    const sliced = to < from ? "" : str.value.slice(from, to);
    return this.stringResult(
      sliced,
      this.isLangTagged(str) ? str.language : undefined,
    );
  }

  /**
   * strdt implements STRDT: the lexical form of a literal re-tagged with the
   * given datatype IRI (its language, if any, is dropped).
   */
  private strdt(
    expressions: Expression[],
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    const value = this.evaluate(expressions[0], binding);
    const datatype = this.evaluate(expressions[1], binding);
    if (value === undefined || datatype === undefined) {
      return undefined;
    }
    if (value.termType !== "Literal" || datatype.termType !== "NamedNode") {
      return undefined;
    }
    return literal(value.value, namedNode(datatype.value));
  }

  /**
   * strlang implements STRLANG: a simple literal re-tagged with the given
   * language tag (a language-tagged input is a type error).
   */
  private strlang(
    expressions: Expression[],
    binding: TermBinding,
  ): rdfjs.Literal | undefined {
    const value = this.evaluate(expressions[0], binding);
    const lang = this.evaluate(expressions[1], binding);
    if (value === undefined || lang === undefined) {
      return undefined;
    }
    if (
      value.termType !== "Literal" || !this.isStringTyped(value) ||
      this.isLangTagged(value)
    ) {
      return undefined;
    }
    if (lang.termType !== "Literal" || !this.isStringTyped(lang)) {
      return undefined;
    }
    return literal(value.value, lang.value);
  }

  /**
   * evaluateFunctionCall dispatches XSD value constructor calls by their
   * function IRI (xsd:integer, xsd:decimal, xsd:double, xsd:float,
   * xsd:string, xsd:boolean); anything else is rejected.
   */
  private evaluateFunctionCall(
    expression: FunctionCallExpression,
    binding: TermBinding,
  ): rdfjs.Term | undefined {
    const fn = expression.function;
    const fnIri = typeof fn === "string"
      ? fn
      : fn.termType === "NamedNode"
      ? fn.value
      : null;
    if (fnIri === null) {
      throw new Error(
        "Unsupported SPARQL expression: functionCall without an IRI function",
      );
    }
    const value = this.evaluate(expression.args[0] as Expression, binding);
    switch (fnIri) {
      case XSD_INTEGER:
        return this.constructorInteger(value);
      case XSD_DECIMAL:
        return this.constructorDecimal(value);
      case XSD_DOUBLE:
        return this.constructorDouble(value);
      case XSD_FLOAT:
        return this.constructorFloat(value);
      case XSD_STRING:
        return this.constructorString(value);
      case XSD_BOOLEAN:
        return this.constructorBoolean(value);
      default:
        throw new Error(
          `Unsupported SPARQL expression: functionCall ${fnIri}`,
        );
    }
  }

  /**
   * constructorInteger implements xsd:integer(x): strict xsd:integer
   * lexical forms, integer-valued numerics, and booleans (1/0) cast; other
   * inputs are type errors.
   */
  private constructorInteger(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined || term.termType !== "Literal") {
      return undefined;
    }
    const datatype = term.datatype?.value;
    if (datatype === XSD_BOOLEAN) {
      return literal(
        term.value === "true" ? "1" : "0",
        namedNode(XSD_INTEGER),
      );
    }
    const numeric = numericValue(term);
    if (numeric !== null) {
      if (typeof numeric === "bigint") {
        return literal(numeric.toString(), namedNode(XSD_INTEGER));
      }
      if (Number.isInteger(numeric)) {
        return literal(String(numeric), namedNode(XSD_INTEGER));
      }
      return undefined;
    }
    if (this.isStringTyped(term) && /^-?\d+$/.test(term.value)) {
      return literal(term.value, namedNode(XSD_INTEGER));
    }
    return undefined;
  }

  /**
   * constructorDecimal implements xsd:decimal(x): numeric values and
   * decimal lexical forms cast to their canonical decimal lexical form.
   */
  private constructorDecimal(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined || term.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(term);
    if (numeric !== null) {
      return literal(
        formatNumber(Number(numeric), XSD_DECIMAL),
        namedNode(XSD_DECIMAL),
      );
    }
    if (this.isStringTyped(term) && /^-?\d+(\.\d+)?$/.test(term.value)) {
      return literal(
        formatNumber(Number(term.value), XSD_DECIMAL),
        namedNode(XSD_DECIMAL),
      );
    }
    return undefined;
  }

  /**
   * constructorDouble implements xsd:double(x), producing the canonical
   * XPath double lexical form ("5.0E0", "1.0E3", "INF").
   */
  private constructorDouble(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined || term.termType !== "Literal") {
      return undefined;
    }
    if (term.datatype?.value === XSD_BOOLEAN) {
      return literal(
        term.value === "true" ? "1.0E0" : "0.0E0",
        namedNode(XSD_DOUBLE),
      );
    }
    const numeric = numericValue(term);
    let n: number;
    if (numeric !== null) {
      n = Number(numeric);
    } else if (this.isStringTyped(term)) {
      n = Number(term.value);
      if (Number.isNaN(n)) {
        return undefined;
      }
    } else {
      return undefined;
    }
    return literal(canonicalDouble(n), namedNode(XSD_DOUBLE));
  }

  /**
   * constructorFloat implements xsd:float(x): the numeric value in its
   * Number string form tagged as xsd:float.
   */
  private constructorFloat(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined || term.termType !== "Literal") {
      return undefined;
    }
    const numeric = numericValue(term);
    let n: number;
    if (numeric !== null) {
      n = Number(numeric);
    } else if (this.isStringTyped(term)) {
      n = Number(term.value);
      if (Number.isNaN(n)) {
        return undefined;
      }
    } else {
      return undefined;
    }
    return literal(String(n), namedNode(XSD_FLOAT));
  }

  /**
   * constructorString implements xsd:string(x): the lexical form of any
   * literal, IRI, or blank node re-tagged as xsd:string.
   */
  private constructorString(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined) {
      return undefined;
    }
    if (
      term.termType === "Literal" || term.termType === "NamedNode" ||
      term.termType === "BlankNode"
    ) {
      return literal(term.value, namedNode(XSD_STRING));
    }
    return undefined;
  }

  /**
   * constructorBoolean implements xsd:boolean(x): boolean passthrough,
   * numeric zero as false (anything else true), and the strings true/1 and
   * false/0; other inputs are type errors.
   */
  private constructorBoolean(
    term: rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (term === undefined || term.termType !== "Literal") {
      return undefined;
    }
    if (term.datatype?.value === XSD_BOOLEAN) {
      return literal(term.value, namedNode(XSD_BOOLEAN));
    }
    const numeric = numericValue(term);
    if (numeric !== null) {
      const value = Number(numeric);
      return literal(value === 0 ? "false" : "true", namedNode(XSD_BOOLEAN));
    }
    if (this.isStringTyped(term) && !this.isLangTagged(term)) {
      const text = term.value;
      if (text === "true" || text === "1") {
        return literal("true", namedNode(XSD_BOOLEAN));
      }
      if (text === "false" || text === "0") {
        return literal("false", namedNode(XSD_BOOLEAN));
      }
    }
    return undefined;
  }

  /**
   * integerValue extracts a strict integer value from a term for SUBSTR
   * positions, or null when the term is not an integer-valued numeric.
   */
  private integerValue(term: rdfjs.Term): number | null {
    if (term.termType !== "Literal") {
      return null;
    }
    const numeric = numericValue(term);
    if (numeric === null) {
      return null;
    }
    if (typeof numeric === "bigint") {
      return Number(numeric);
    }
    return Number.isInteger(numeric) ? numeric : null;
  }

  /**
   * stringResult builds a string-function result: language-tagged inputs
   * keep their language, everything else becomes an xsd:string literal.
   */
  private stringResult(
    value: string,
    lang: string | undefined,
  ): rdfjs.Literal {
    return lang === undefined || lang === ""
      ? literal(value, namedNode(XSD_STRING))
      : literal(value, lang);
  }

  /**
   * ebv computes the effective boolean value of a term: false for empty
   * strings, numeric zero, and xsd:boolean false; true for other literals and
   * non-literal terms; and "error" for unbound values, lang-tagged literals,
   * and datatypes whose EBV is undefined.
   */
  private ebv(term: rdfjs.Term | undefined): Ebv {
    if (term === undefined) {
      return "error";
    }
    if (term.termType !== "Literal") {
      return true;
    }
    const datatype = term.datatype?.value;
    if (datatype === XSD_BOOLEAN) {
      return term.value === "true";
    }
    if (this.isLangTagged(term)) {
      return "error";
    }
    if (datatype === undefined || datatype === XSD_STRING) {
      return term.value !== "";
    }
    if (NUMERIC_DATATYPES.has(datatype)) {
      const numeric = Number(term.value);
      return !Number.isNaN(numeric) && numeric !== 0;
    }
    return "error";
  }
}

/**
 * booleanLiteral builds an xsd:boolean literal.
 */
function booleanLiteral(value: boolean): rdfjs.Literal {
  return literal(value ? "true" : "false", namedNode(XSD_BOOLEAN));
}

/**
 * canonicalDouble renders a number in the canonical XPath double lexical
 * form: a mantissa in [1, 10) with at least one fractional digit followed by
 * an exponent without a leading sign ("5.0E0", "1.0E3", "3.5E-1").
 */
function canonicalDouble(n: number): string {
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

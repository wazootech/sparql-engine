import type * as rdfjs from "@rdfjs/types";
import type {
  AggregateExpression,
  Expression,
  FunctionCallExpression,
  OperationExpression,
  Term as SparqlTerm,
} from "sparqljs";
import { DataFactory } from "n3";
import {
  md5Hex,
  parseDateTime,
  sha1Hex,
  sha256Hex,
  sha384Hex,
  sha512Hex,
  timezoneDurationLexical,
  XSD_DATETIME,
  XSD_DAYTIME_DURATION,
} from "@/term/mod.ts";
import type { TermBinding } from "@/evaluator/bgp-evaluator.ts";
import {
  canonicalDouble,
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

const { blankNode, literal, namedNode, quad } = DataFactory;

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
   * bnodeCounter mints fresh labels for zero-argument BNODE() calls, so two
   * calls in one query produce distinct blank nodes. Labels are opaque per
   * SPARQL 1.1; only freshness within a query matters.
   */
  private bnodeCounter = 0;

  /**
   * evaluate resolves an expression against a binding. Returns undefined for
   * unbound variables and runtime errors (type errors, division by zero).
   */
  public evaluate(
    expression: Expression,
    binding: TermBinding,
  ): rdfjs.Term | undefined {
    return this.evaluateWith(expression, binding);
  }

  /**
   * evaluateWithAggregates resolves an expression like evaluate(), but
   * aggregate subexpressions (COUNT, SUM, ...) are resolved through the
   * supplied resolver rather than rejected. It is used by GROUP BY
   * projection, HAVING, and aggregate ORDER BY clauses, where each grouped
   * solution carries its group's raw solutions.
   */
  public evaluateWithAggregates(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Term | undefined {
    return this.evaluateWith(expression, binding, aggregates);
  }

  /**
   * filterPassesWithAggregates applies FILTER/HAVING EBV semantics to an
   * expression that may contain aggregates.
   */
  public filterPassesWithAggregates(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): boolean {
    return this.ebv(this.evaluateWith(expression, binding, aggregates)) ===
      true;
  }

  private evaluateWith(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
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
    if (expression.type === "aggregate") {
      if (aggregates !== undefined) {
        return aggregates(expression);
      }
      throw new Error("Unsupported SPARQL expression: aggregate");
    }
    if (expression.type === "functionCall") {
      return this.evaluateFunctionCall(expression, binding, aggregates);
    }
    if (expression.type !== "operation") {
      throw new Error(
        `Unsupported SPARQL expression: ${
          (expression as { type: string }).type
        }`,
      );
    }
    return this.evaluateOperation(expression, binding, aggregates);
  }

  /**
   * filterPasses is true exactly when the expression's EBV is true; used by
   * FILTER, where errors and false values both drop the binding.
   */
  public filterPasses(
    expression: Expression,
    binding: TermBinding,
  ): boolean {
    return this.ebv(this.evaluateWith(expression, binding)) === true;
  }

  private evaluateOperation(
    operation: OperationExpression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Term | undefined {
    const arg = (index: number): Expression =>
      operation.args[index] as Expression;
    switch (operation.operator) {
      case "&&":
      case "||": {
        const left = this.ebv(this.evaluateWith(arg(0), binding, aggregates));
        const right = this.ebv(this.evaluateWith(arg(1), binding, aggregates));
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
        const value = this.ebv(this.evaluateWith(arg(0), binding, aggregates));
        return value === "error" ? undefined : booleanLiteral(!value);
      }
      case "=":
      case "!=":
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const a = this.evaluateWith(arg(0), binding, aggregates);
        const b = this.evaluateWith(arg(1), binding, aggregates);
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
          return this.unaryMinus(arg(0), binding, aggregates);
        }
        const a = this.evaluateWith(arg(0), binding, aggregates);
        const b = this.evaluateWith(arg(1), binding, aggregates);
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
        return this.str(this.evaluateWith(arg(0), binding, aggregates));
      case "strlen": {
        const value = this.evaluateWith(arg(0), binding, aggregates);
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
        return this.stringCase(operation.operator, arg(0), binding, aggregates);
      case "concat":
        return this.concat(operation.args as Expression[], binding, aggregates);
      case "substr":
        return this.substr(operation.args as Expression[], binding, aggregates);
      case "strdt":
        return this.strdt(operation.args as Expression[], binding, aggregates);
      case "strlang":
        return this.strlang(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "regex":
        return this.regex(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "replace":
        return this.replace(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "contains":
        return this.stringPredicate(
          operation.args as Expression[],
          binding,
          (value, argument) => value.includes(argument),
          aggregates,
        );
      case "strstarts":
        return this.stringPredicate(
          operation.args as Expression[],
          binding,
          (value, argument) => value.startsWith(argument),
          aggregates,
        );
      case "strends":
        return this.stringPredicate(
          operation.args as Expression[],
          binding,
          (value, argument) => value.endsWith(argument),
          aggregates,
        );
      case "strbefore":
        return this.stringSlice(
          operation.args as Expression[],
          binding,
          true,
          aggregates,
        );
      case "strafter":
        return this.stringSlice(
          operation.args as Expression[],
          binding,
          false,
          aggregates,
        );
      case "lang":
        return this.lang(operation.args[0] as Expression, binding, aggregates);
      case "langmatches":
        return this.langmatches(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "coalesce":
        return this.coalesce(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "if":
        return this.ifElse(operation.args as Expression[], binding, aggregates);
      case "in":
        return this.inList(operation.args as Expression[], binding, aggregates);
      case "notin": {
        const member = this.inList(
          operation.args as Expression[],
          binding,
          aggregates,
        );
        if (member === undefined) {
          return undefined;
        }
        return booleanLiteral(member.value !== "true");
      }
      case "sameterm":
        return this.sameterm(
          operation.args as Expression[],
          binding,
          aggregates,
        );
      case "BNODE":
        return this.bnode(operation.args as Expression[], binding, aggregates);
      case "struuid":
        return this.struuid();
      case "uuid":
        return this.uuid();
      case "rand":
        return this.rand();
      case "abs":
      case "ceil":
      case "floor":
      case "round":
        return this.numericRound(
          operation.operator as "abs" | "ceil" | "floor" | "round",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "now":
        return this.now();
      case "year":
      case "month":
      case "day":
      case "hours":
      case "minutes":
        return this.dateComponent(
          operation.operator as "year" | "month" | "day" | "hours" | "minutes",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "seconds":
        return this.seconds(operation.args[0] as Expression, binding, aggregates);
      case "timezone":
        return this.timezone(
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "md5":
      case "sha1":
      case "sha256":
      case "sha384":
      case "sha512":
        return this.hash(
          operation.operator as "md5" | "sha1" | "sha256" | "sha384" |
            "sha512",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "triple":
        return this.triple(operation.args as Expression[], binding, aggregates);
      case "subject":
        return this.tripleComponent(
          "subject",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "predicate":
        return this.tripleComponent(
          "predicate",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "object":
        return this.tripleComponent(
          "object",
          operation.args[0] as Expression,
          binding,
          aggregates,
        );
      case "istriple":
        return this.isTriple(operation.args[0] as Expression, binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    let result = "";
    for (const expression of expressions) {
      const value = this.evaluateWith(expression, binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    if (expressions.length < 2 || expressions.length > 3) {
      return undefined;
    }
    const str = this.evaluateWith(expressions[0], binding, aggregates);
    const startTerm = this.evaluateWith(expressions[1], binding, aggregates);
    const lenTerm = expressions.length === 3
      ? this.evaluateWith(expressions[2], binding, aggregates)
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expressions[0], binding, aggregates);
    const datatype = this.evaluateWith(expressions[1], binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expressions[0], binding, aggregates);
    const lang = this.evaluateWith(expressions[1], binding, aggregates);
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
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
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
    const value = this.evaluateWith(
      expression.args[0] as Expression,
      binding,
      aggregates,
    );
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

  /**
   * stringTerm evaluates an expression that must yield a string-typed literal
   * (simple, xsd:string, or language-tagged), returning the literal or
   * undefined for any other term or an evaluation error.
   */
  private stringTerm(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (
      value === undefined || value.termType !== "Literal" ||
      !this.isStringTyped(value)
    ) {
      return undefined;
    }
    return value;
  }

  /**
   * stringPredicate implements CONTAINS, STRSTARTS, and STRENDS: two string
   * arguments tested by the given relation, returning an xsd:boolean literal.
   */
  private stringPredicate(
    args: Expression[],
    binding: TermBinding,
    test: (value: string, argument: string) => boolean,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.stringTerm(args[0], binding, aggregates);
    const argument = this.stringTerm(args[1], binding, aggregates);
    if (value === undefined || argument === undefined) {
      return undefined;
    }
    return booleanLiteral(test(value.value, argument.value));
  }

  /**
   * stringSlice implements STRBEFORE and STRAFTER: the portion of the first
   * string argument before (or after) the first occurrence of the second,
   * keeping the first argument's language tag. An absent needle yields the
   * empty string, matching the reference engines.
   */
  private stringSlice(
    args: Expression[],
    binding: TermBinding,
    before: boolean,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.stringTerm(args[0], binding, aggregates);
    const needle = this.stringTerm(args[1], binding, aggregates);
    if (value === undefined || needle === undefined) {
      return undefined;
    }
    const index = value.value.indexOf(needle.value);
    let result: string;
    if (index === -1) {
      result = "";
    } else if (before) {
      result = value.value.slice(0, index);
    } else {
      result = value.value.slice(index + needle.value.length);
    }
    return this.stringResult(
      result,
      this.isLangTagged(value) ? value.language : undefined,
    );
  }

  /**
   * regex implements REGEX: the pattern (with optional flags) is compiled as
   * a JS regular expression and tested against the string. A malformed
   * pattern or flags, or a non-string argument, is an evaluation error
   * (unbound) — the reference engine throws on malformed patterns, which is
   * a deviation we deliberately do not replicate.
   */
  private regex(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.stringTerm(args[0], binding, aggregates);
    const pattern = this.stringTerm(args[1], binding, aggregates);
    if (value === undefined || pattern === undefined) {
      return undefined;
    }
    let flags = "";
    if (args.length > 2) {
      const flagsTerm = this.stringTerm(args[2], binding, aggregates);
      if (flagsTerm === undefined) {
        return undefined;
      }
      flags = flagsTerm.value;
    }
    let expression: RegExp;
    try {
      expression = new RegExp(pattern.value, flags);
    } catch {
      return undefined;
    }
    return booleanLiteral(expression.test(value.value));
  }

  /**
   * replace implements REPLACE: every match of the pattern (with optional
   * flags) is replaced by the replacement, which may reference capture
   * groups ($1). The result keeps the first argument's language tag,
   * matching the reference engines.
   */
  private replace(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.stringTerm(args[0], binding, aggregates);
    const pattern = this.stringTerm(args[1], binding, aggregates);
    const replacement = this.stringTerm(args[2], binding, aggregates);
    if (
      value === undefined || pattern === undefined ||
      replacement === undefined
    ) {
      return undefined;
    }
    let flags = "";
    if (args.length > 3) {
      const flagsTerm = this.stringTerm(args[3], binding, aggregates);
      if (flagsTerm === undefined) {
        return undefined;
      }
      flags = flagsTerm.value;
    }
    let expression: RegExp;
    try {
      expression = new RegExp(pattern.value, `${flags}g`);
    } catch {
      return undefined;
    }
    const result = value.value.replace(expression, replacement.value);
    return this.stringResult(
      result,
      this.isLangTagged(value) ? value.language : undefined,
    );
  }

  /**
   * lang implements LANG: the language tag of a literal, or the empty string
   * for a literal without one. Non-literal arguments are a type error.
   */
  private lang(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (value === undefined || value.termType !== "Literal") {
      return undefined;
    }
    return literal(value.language ?? "", namedNode(XSD_STRING));
  }

  /**
   * langmatches implements LANGMATCHES basic filtering: the range "*"
   * matches anything; otherwise the lowercased tag equals the lowercased
   * range or has it as a prefix followed by "-".
   */
  private langmatches(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const tag = this.stringTerm(args[0], binding, aggregates);
    const range = this.stringTerm(args[1], binding, aggregates);
    if (tag === undefined || range === undefined) {
      return undefined;
    }
    const tagValue = tag.value.toLowerCase();
    const rangeValue = range.value.toLowerCase();
    const matches = rangeValue === "*" || tagValue === rangeValue ||
      tagValue.startsWith(`${rangeValue}-`);
    return booleanLiteral(matches);
  }

  /**
   * coalesce implements COALESCE: the first argument that evaluates without
   * error; unbound values and evaluation errors are skipped.
   */
  private coalesce(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Term | undefined {
    for (const arg of args) {
      const value = this.evaluateWith(arg, binding, aggregates);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * ifElse implements IF: the condition's effective boolean value selects
   * the true or false branch; an error condition propagates.
   */
  private ifElse(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Term | undefined {
    const condition = this.ebv(this.evaluateWith(args[0], binding, aggregates));
    if (condition === "error") {
      return undefined;
    }
    return this.evaluateWith(args[condition ? 1 : 2], binding, aggregates);
  }

  /**
   * inList implements IN: true when the value equals (by `=` semantics) any
   * list element, false otherwise. An unbound value, or an erroring element
   * before any match, propagates as an error (SPARQL 1.1 §17.4.1.11).
   */
  private inList(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(args[0], binding, aggregates);
    if (value === undefined) {
      return undefined;
    }
    const list = args[1] as unknown as Expression[];
    let sawError = false;
    for (const element of list) {
      const candidate = this.evaluateWith(element, binding, aggregates);
      if (candidate === undefined) {
        sawError = true;
        continue;
      }
      if (this.valuesEqual(value, candidate)) {
        return booleanLiteral(true);
      }
    }
    if (sawError) {
      return undefined;
    }
    return booleanLiteral(false);
  }

  /**
   * sameterm implements SAMETERM: term identity (type, value, and literal
   * language/datatype), with RDF-star triple terms compared structurally.
   */
  private sameterm(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const a = this.evaluateWith(args[0], binding, aggregates);
    const b = this.evaluateWith(args[1], binding, aggregates);
    if (a === undefined || b === undefined) {
      return undefined;
    }
    return booleanLiteral(sameRdfTerm(a, b));
  }

  /**
   * bnode implements BNODE: no argument mints a fresh blank node; a string
   * argument creates a blank node labeled from it (the same label yields
   * the same node within one query). Non-string arguments are type errors.
   */
  private bnode(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.BlankNode | undefined {
    if (args.length === 0) {
      return blankNode(`b${++this.bnodeCounter}`);
    }
    const value = this.stringTerm(args[0], binding, aggregates);
    if (value === undefined) {
      return undefined;
    }
    return blankNode(value.value);
  }

  /**
   * struuid implements STRUUID: a fresh UUID as an xsd:string literal.
   */
  private struuid(): rdfjs.Literal {
    return literal(crypto.randomUUID(), namedNode(XSD_STRING));
  }

  /**
   * uuid implements UUID: a fresh urn:uuid: IRI.
   */
  private uuid(): rdfjs.NamedNode {
    return namedNode(`urn:uuid:${crypto.randomUUID()}`);
  }

  /**
   * rand implements RAND: a random double in [0, 1) in canonical form.
   */
  private rand(): rdfjs.Literal {
    return literal(canonicalDouble(Math.random()), namedNode(XSD_DOUBLE));
  }

  /**
   * now implements NOW: the current instant as an xsd:dateTime literal.
   */
  private now(): rdfjs.Literal {
    return literal(new Date().toISOString(), namedNode(XSD_DATETIME));
  }

  /**
   * numericRound implements ABS, CEIL, FLOOR, and ROUND over a numeric
   * literal, preserving the input datatype: integers stay exact via BigInt,
   * decimals and floats use their Number form, and doubles canonicalize to
   * the XPath exponent form. Non-numeric inputs are type errors.
   */
  private numericRound(
    operation: "abs" | "ceil" | "floor" | "round",
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (value === undefined || value.termType !== "Literal") {
      return undefined;
    }
    const datatype = value.datatype?.value;
    const numeric = numericValue(value);
    if (numeric === null) {
      return undefined;
    }
    if (datatype === XSD_INTEGER && typeof numeric === "bigint") {
      let result: bigint = numeric;
      if (operation === "abs") {
        result = result < 0n ? -result : result;
      }
      return literal(result.toString(), namedNode(XSD_INTEGER));
    }
    const numberValue = Number(numeric);
    let result: number;
    if (operation === "abs") {
      result = Math.abs(numberValue);
    } else if (operation === "ceil") {
      result = Math.ceil(numberValue);
    } else if (operation === "floor") {
      result = Math.floor(numberValue);
    } else {
      result = Math.round(numberValue);
    }
    if (datatype === XSD_DOUBLE) {
      return literal(canonicalDouble(result), namedNode(XSD_DOUBLE));
    }
    return literal(
      formatNumber(result, datatype ?? XSD_DECIMAL),
      namedNode(datatype ?? XSD_DECIMAL),
    );
  }

  /**
   * dateComponent implements YEAR, MONTH, DAY, HOURS, and MINUTES over an
   * xsd:dateTime literal, returning the component as an integer literal.
   */
  private dateComponent(
    component: "year" | "month" | "day" | "hours" | "minutes",
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (
      value === undefined || value.termType !== "Literal" ||
      value.datatype?.value !== XSD_DATETIME
    ) {
      return undefined;
    }
    const parts = parseDateTime(value.value);
    if (parts === null) {
      return undefined;
    }
    return literal(String(parts[component]), namedNode(XSD_INTEGER));
  }

  /**
   * seconds implements SECONDS: the seconds (including any fraction) of an
   * xsd:dateTime literal as a decimal literal.
   */
  private seconds(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (
      value === undefined || value.termType !== "Literal" ||
      value.datatype?.value !== XSD_DATETIME
    ) {
      return undefined;
    }
    const parts = parseDateTime(value.value);
    if (parts === null) {
      return undefined;
    }
    return literal(formatNumber(parts.seconds, XSD_DECIMAL), namedNode(XSD_DECIMAL));
  }

  /**
   * timezone implements TIMEZONE: the signed UTC offset of an xsd:dateTime
   * literal as an xsd:dayTimeDuration literal; a literal without a timezone
   * is an evaluation error.
   */
  private timezone(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (
      value === undefined || value.termType !== "Literal" ||
      value.datatype?.value !== XSD_DATETIME
    ) {
      return undefined;
    }
    const parts = parseDateTime(value.value);
    if (parts === null || !parts.hasTimezone) {
      return undefined;
    }
    return literal(
      timezoneDurationLexical(parts.timezoneMinutes),
      namedNode(XSD_DAYTIME_DURATION),
    );
  }

  /**
   * hash implements MD5 and the SHA family: the digest of the string
   * argument as lowercase hexadecimal, typed xsd:string.
   */
  private hash(
    algorithm: "md5" | "sha1" | "sha256" | "sha384" | "sha512",
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.stringTerm(expression, binding, aggregates);
    if (value === undefined) {
      return undefined;
    }
    let digest: string;
    switch (algorithm) {
      case "md5":
        digest = md5Hex(value.value);
        break;
      case "sha1":
        digest = sha1Hex(value.value);
        break;
      case "sha256":
        digest = sha256Hex(value.value);
        break;
      case "sha384":
        digest = sha384Hex(value.value);
        break;
      case "sha512":
        digest = sha512Hex(value.value);
        break;
    }
    return literal(digest, namedNode(XSD_STRING));
  }

  /**
   * triple implements TRIPLE: an RDF-star triple term built from its three
   * arguments; any argument error propagates.
   */
  private triple(
    args: Expression[],
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Quad | undefined {
    const subject = this.evaluateWith(args[0], binding, aggregates);
    const predicate = this.evaluateWith(args[1], binding, aggregates);
    const object = this.evaluateWith(args[2], binding, aggregates);
    if (subject === undefined || predicate === undefined || object === undefined) {
      return undefined;
    }
    return quad(
      subject as rdfjs.Quad_Subject,
      predicate as rdfjs.Quad_Predicate,
      object as rdfjs.Quad_Object,
    );
  }

  /**
   * tripleComponent implements SUBJECT, PREDICATE, and OBJECT: the
   * corresponding component of an RDF-star triple term; any other term is a
   * type error.
   */
  private tripleComponent(
    component: "subject" | "predicate" | "object",
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Term | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (value === undefined || value.termType !== "Quad") {
      return undefined;
    }
    return value[component];
  }

  /**
   * isTriple implements isTRIPLE: true exactly for RDF-star triple terms;
   * an evaluation error propagates.
   */
  private isTriple(
    expression: Expression,
    binding: TermBinding,
    aggregates?: (aggregate: AggregateExpression) => rdfjs.Term | undefined,
  ): rdfjs.Literal | undefined {
    const value = this.evaluateWith(expression, binding, aggregates);
    if (value === undefined) {
      return undefined;
    }
    return booleanLiteral(value.termType === "Quad");
  }
}


/**
 * booleanLiteral builds an xsd:boolean literal.
 */
function booleanLiteral(value: boolean): rdfjs.Literal {
  return literal(value ? "true" : "false", namedNode(XSD_BOOLEAN));
}

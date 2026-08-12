import type * as rdfjs from "@rdfjs/types";
import type {
  Expression,
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
 * BigInt results), bound(), STR(), and STRLEN(). Unsupported expression kinds
 * (function calls, aggregates, IN tuples) raise a clear error.
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

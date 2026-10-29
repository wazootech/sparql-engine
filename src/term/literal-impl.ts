import type * as rdfjs from "@rdfjs/types";
import {
  NamedNodeImpl,
  RDF_DIR_LANG_STRING,
  RDF_LANG_STRING,
  XSD_STRING,
} from "@/term/term-impl.ts";

export class LiteralImpl implements rdfjs.Literal {
  public readonly termType = "Literal" as const;
  public readonly language: string;
  public readonly direction: "ltr" | "rtl" | "";
  public readonly datatype: rdfjs.NamedNode;

  public constructor(
    public readonly value: string,
    languageOrDatatype?: string | rdfjs.NamedNode | rdfjs.DirectionalLanguage,
  ) {
    if (typeof languageOrDatatype === "string") {
      this.language = languageOrDatatype.toLowerCase();
      this.direction = "";
      this.datatype = new NamedNodeImpl(RDF_LANG_STRING);
    } else if (
      languageOrDatatype && typeof languageOrDatatype === "object" &&
      "termType" in languageOrDatatype
    ) {
      this.language = "";
      this.direction = "";
      this.datatype = languageOrDatatype;
    } else if (
      languageOrDatatype && typeof languageOrDatatype === "object" &&
      "language" in languageOrDatatype
    ) {
      // DirectionalLanguage: a language tag with an optional RDF 1.2 initial
      // text direction. A direction makes this an rdf:dirLangString literal.
      this.language = languageOrDatatype.language.toLowerCase();
      this.direction = languageOrDatatype.direction ?? "";
      this.datatype = new NamedNodeImpl(
        this.direction ? RDF_DIR_LANG_STRING : RDF_LANG_STRING,
      );
    } else {
      this.language = "";
      this.direction = "";
      this.datatype = new NamedNodeImpl(XSD_STRING);
    }
  }

  public equals(other?: rdfjs.Term | null): boolean {
    if (!other || other.termType !== "Literal") {
      return false;
    }
    return (
      this.value === other.value &&
      this.language === other.language &&
      (this.direction ?? "") === ((other as rdfjs.Literal).direction ?? "") &&
      this.datatype.value === other.datatype.value
    );
  }
}

// These npm packages ship no TypeScript types, so tsc (bun check) needs a
// declaration for each; call sites type the surface
// they use themselves (see src/parser/generate-parser.ts).
declare module "jison";
declare module "ebnf-parser";
declare module "n3";
declare module "n3-rdfstar";

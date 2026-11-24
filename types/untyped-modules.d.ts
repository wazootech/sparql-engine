// These npm packages ship no TypeScript types. Deno treats such imports as
// `any`; tsc (bun check) needs the declaration. Call sites type the surface
// they use themselves (see src/parser/generate-parser.ts).
declare module "jison";
declare module "ebnf-parser";
declare module "n3";
declare module "n3-rdfstar";

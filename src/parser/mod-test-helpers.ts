import { Parser } from "./mod.ts";

export function parseExpression(query: string): {
  name: string;
  args: unknown[];
} {
  const ast = new Parser({ sparqlStar: true }).parse(query);
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<{
    type: string;
    expression?: { type: string; operator: string; args: unknown[] };
  }>;
  const bind = where.find((w) => w.type === "bind");
  if (!bind?.expression) {
    throw new Error(`no BIND expression found in ${query}`);
  }
  return { name: bind.expression.operator, args: bind.expression.args };
}

export function parseBgpTriples(query: string): Array<{
  subject: { value?: string; termType?: string };
  predicate: { value?: string; termType?: string };
  object: { value?: string; termType?: string };
}> {
  const ast = new Parser({
    sparqlStar: true,
    prefixes: { "": "http://example.com/ns#" },
  }).parse(query);
  if (ast.type !== "query") throw new Error("expected a query");
  const where = ast.where as Array<{ type: string; triples: unknown[] }>;
  const bgp = where.find((w) => w.type === "bgp");
  if (!bgp) throw new Error(`no BGP found in ${query}`);
  return bgp.triples as never;
}

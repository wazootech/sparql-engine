// Treemap SVG generator for the README's size & memory comparison.
//
// Reads bench/size-data.json (from bench/measure-libs.ts) and
// bench/memory-data.json (from bench/memory-probe.ts) and writes:
//
//   docs/assets/treemap-library-size.svg
//   docs/assets/treemap-memory.svg
//
// Run: deno run --allow-read --allow-write bench/treemap.ts
import { join } from "@std/path";

interface Sized {
  name: string;
  bytes: number;
  children?: Sized[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Squarified treemap layout (Bruls, Huizing, van Wijk 2000)          */
/* ------------------------------------------------------------------ */

interface Placed {
  name: string;
  rect: Rect;
  color: string;
  valueText: string;
  children?: Placed[];
  /** panel renders a titled container (no fill rect) around its children. */
  panel?: string;
}

const COLORS = ["#2f9e44", "#1971c2", "#f08c00"]; // native, oxigraph, comunica

function worst(row: { bytes: number }[], rect: Rect): number {
  const total = row.reduce((s, i) => s + i.bytes, 0);
  const rowW = total / rect.h; // strip width (vertical slice)
  let worst = -Infinity;
  for (const item of row) {
    const w = item.bytes / rect.h;
    const ratio = Math.max(w / rowW, rowW / w);
    worst = Math.max(worst, ratio);
  }
  return worst;
}

function squarifyRow(
  row: { bytes: number }[],
  rect: Rect,
): { placed: Rect[]; remainder: Rect } {
  const total = row.reduce((s, i) => s + i.bytes, 0);
  if (rect.w >= rect.h) {
    const rowW = total / rect.h;
    const placed: Rect[] = [];
    let y = rect.y;
    for (const item of row) {
      const h = item.bytes / rowW;
      placed.push({ x: rect.x, y, w: rowW, h });
      y += h;
    }
    return {
      placed,
      remainder: { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h },
    };
  }
  const rowH = total / rect.w;
  const placed: Rect[] = [];
  let x = rect.x;
  for (const item of row) {
    const w = item.bytes / rowH;
    placed.push({ x, y: rect.y, w, h: rowH });
    x += w;
  }
  return {
    placed,
    remainder: { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH },
  };
}

function squarify(
  items: { name: string; bytes: number }[],
  rect: Rect,
): { name: string; rect: Rect }[] {
  // Normalize the item weights to the rect's pixel area so the squarified
  // rows tile it exactly.
  const total = items.reduce((s, i) => s + i.bytes, 0);
  const scale = total === 0 ? 1 : (rect.w * rect.h) / total;
  const scaled = items.map((item) => ({
    name: item.name,
    bytes: item.bytes * scale,
  }));
  const sorted = [...scaled].sort((a, b) => b.bytes - a.bytes);
  const result: { name: string; rect: Rect }[] = [];
  let remaining = { ...rect };
  let index = 0;
  while (index < sorted.length) {
    const row: { name: string; bytes: number }[] = [];
    row.push(sorted[index++]);
    while (index < sorted.length) {
      const current = worst(row, remaining);
      const extended = worst([...row, sorted[index]], remaining);
      if (extended <= current) {
        row.push(sorted[index++]);
      } else {
        break;
      }
    }
    const { placed, remainder } = squarifyRow(row, remaining);
    for (let i = 0; i < row.length; i++) {
      result.push({ name: row[i].name, rect: placed[i] });
    }
    remaining = remainder;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* SVG rendering                                                      */
/* ------------------------------------------------------------------ */

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1048576).toFixed(2)} MiB`;
  }
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}

function renderNode(
  node: Placed,
  depth: number,
  parts: string[],
): void {
  const { x, y, w, h } = node.rect;
  if (node.panel !== undefined) {
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
        `height="${
          h.toFixed(1)
        }" fill="#f1f3f5" stroke="#dee2e6" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${(x + 6).toFixed(1)}" y="${(y + 16).toFixed(1)}" ` +
        `font-family="sans-serif" font-size="10" font-weight="bold" fill="#495057">` +
        `${esc(node.panel)}</text>`,
    );
    for (const child of node.children ?? []) {
      renderNode(child, depth + 1, parts);
    }
    return;
  }
  parts.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" ` +
      `height="${
        h.toFixed(1)
      }" fill="${node.color}" stroke="#ffffff" stroke-width="1"/>`,
  );
  const label = `${node.name} (${node.valueText})`;
  const fits = w > label.length * 5.5 && h > 12;
  if (fits) {
    parts.push(
      `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 3).toFixed(1)}" ` +
        `text-anchor="middle" font-family="sans-serif" font-size="10" fill="#fff">` +
        `${esc(node.name)}<tspan x="${(x + w / 2).toFixed(1)}" dy="12" ` +
        `font-size="8" fill="#ffffffcc">${esc(node.valueText)}</tspan></text>`,
    );
  } else if (w > 2 && h > 2) {
    parts.push(
      `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" ` +
        `text-anchor="middle" font-family="sans-serif" font-size="8" fill="#495057">` +
        `${esc(label)}</text>`,
    );
  }
  for (const child of node.children ?? []) {
    renderNode(child, depth + 1, parts);
  }
}

function treemapSvg(
  title: string,
  subtitle: string,
  roots: Placed[],
  width = 720,
  height = 320,
): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `font-family="sans-serif"><rect width="${width}" height="${height}" fill="#f8f9fa"/>`,
  );
  parts.push(
    `<text x="12" y="20" font-size="13" font-weight="bold" fill="#212529">` +
      `${esc(title)}</text>`,
  );
  parts.push(
    `<text x="12" y="34" font-size="9" fill="#868e96">${esc(subtitle)}</text>`,
  );
  for (const root of roots) {
    renderNode(root, 0, parts);
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* Data -> placed trees                                               */
/* ------------------------------------------------------------------ */

function sizeTree(): Placed[] {
  const data = JSON.parse(
    Deno.readTextFileSync(join(Deno.cwd(), "bench", "size-data.json")),
  ) as { engines: Sized[] };
  const rootRect: Rect = { x: 12, y: 44, w: 696, h: 264 };
  const engines = [...data.engines].sort((a, b) => b.bytes - a.bytes);
  const roots: Placed[] = [];
  const top: Placed[] = [];
  const laidOut = squarify(
    engines.map((e) => ({ name: e.name, bytes: e.bytes })),
    rootRect,
  );
  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i];
    const rect = laidOut.find((l) => l.name === engine.name)!.rect;
    const children = engine.children ?? [];
    const capped = children.slice(0, 8);
    const otherBytes = children
      .slice(8)
      .reduce((s, c) => s + c.bytes, 0);
    const items = otherBytes > 0
      ? [...capped, { name: "other deps", bytes: otherBytes }]
      : capped;
    const childLayout = squarify(items, {
      x: rect.x + 2,
      y: rect.y + 2,
      w: Math.max(rect.w - 4, 1),
      h: Math.max(rect.h - 4, 1),
    });
    const childPlaced: Placed[] = [];
    for (const layout of childLayout) {
      const item = items.find((it) => it.name === layout.name)!;
      childPlaced.push({
        name: layout.name,
        rect: layout.rect,
        color: shade(COLORS[i], 0.65),
        valueText: fmtBytes(item.bytes),
      });
    }
    roots.push({
      name: engine.name,
      rect,
      color: COLORS[i],
      valueText: fmtBytes(engine.bytes),
      children: childPlaced,
    });
  }
  void top;
  return roots;
}

/** shade mixes a hex color toward white by `amount`. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amount);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function memoryTree(): Placed[] {
  const data = JSON.parse(
    Deno.readTextFileSync(join(Deno.cwd(), "bench", "memory-data.json")),
  ) as {
    engines: Record<
      string,
      { scan: { peakHeap: number }; exists: { peakHeap: number } }
    >;
  };
  const names = ["native", "comunica", "oxigraph"];
  const workloads = ["scan", "exists"] as const;
  const labels: Record<string, string> = {
    scan: "full scan (55k rows materialized)",
    exists: "nested EXISTS",
  };
  const panelW = 348;
  const roots: Placed[] = [];
  for (let wi = 0; wi < workloads.length; wi++) {
    const wl = workloads[wi];
    const items = names.map((name, i) => ({
      name,
      bytes: data.engines[name][wl].peakHeap,
      color: COLORS[i],
    }));
    const outer: Rect = { x: 12 + wi * panelW, y: 44, w: panelW - 6, h: 244 };
    const inner: Rect = {
      x: outer.x + 2,
      y: outer.y + 24,
      w: outer.w - 4,
      h: outer.h - 26,
    };
    const layout = squarify(items, inner);
    const children = layout.map((l) => ({
      name: l.name,
      rect: l.rect,
      color: items.find((i) => i.name === l.name)!.color,
      valueText: fmtBytes(data.engines[l.name][wl].peakHeap),
    }));
    roots.push({
      name: labels[wl],
      rect: outer,
      color: "#f1f3f5",
      valueText: "",
      panel: labels[wl],
      children,
    });
  }
  return roots;
}

/* ------------------------------------------------------------------ */
/* Per-entrypoint consumer closure bar chart                         */
/* ------------------------------------------------------------------ */

/** closuresChart renders a horizontal bar chart of the per-entrypoint
 * value-import closures from bench/closures-data.json (measure-closures.ts).
 * Returns true when the data file exists and the SVG was written. */
function closuresChart(): boolean {
  const dataPath = join(Deno.cwd(), "bench", "closures-data.json");
  try {
    Deno.statSync(dataPath);
  } catch {
    return false;
  }
  const data = JSON.parse(Deno.readTextFileSync(dataPath)) as {
    entries: { name: string; bytes: number; files: string[] }[];
  };
  const SUBPATH_LABEL: Record<string, string> = {
    ".": "@wazoo/sparql-engine (full)",
    "./term": "@wazoo/sparql-engine/term",
    "./store": "@wazoo/sparql-engine/store",
    "./parser": "@wazoo/sparql-engine/parser",
    "./serialize": "@wazoo/sparql-engine/serialize",
  };
  const entries = [...data.entries]
    .map((e) => ({ ...e, label: SUBPATH_LABEL[e.name] ?? e.name }))
    .sort((a, b) => a.bytes - b.bytes);
  const max = Math.max(...entries.map((e) => e.bytes), 1);
  const width = 720;
  const height = 40 + entries.length * 34 + 14;
  const padL = 16;
  const padR = 250; // label column
  const barW = width - padL - padR;
  const barH = 18;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `font-family="sans-serif"><rect width="${width}" height="${height}" fill="#f8f9fa"/>`,
  );
  parts.push(
    `<text x="12" y="20" font-size="13" font-weight="bold" fill="#212529">` +
      `Per-entrypoint consumer closure</text>`,
  );
  parts.push(
    `<text x="12" y="34" font-size="9" fill="#868e96">` +
      `Value-import graph of what each subpath loads from the published package ` +
      `(type-only imports erased)</text>`,
  );
  entries.forEach((entry, i) => {
    const y = 46 + i * 34;
    const len = Math.max((entry.bytes / max) * barW, 1);
    parts.push(
      `<rect x="${padL}" y="${y}" width="${len.toFixed(1)}" height="${barH}" ` +
        `fill="#1971c2" rx="2"/>`,
    );
    parts.push(
      `<text x="${padL + barW}" y="${(y + barH / 2 + 3).toFixed(1)}" ` +
        `text-anchor="end" font-family="sans-serif" font-size="10" fill="#212529">` +
        `${esc(entry.label)} — ${
          fmtBytes(entry.bytes)
        } (${entry.files.length} files)</text>`,
    );
  });
  parts.push("</svg>");
  Deno.writeTextFileSync(
    join(Deno.cwd(), "docs", "assets", "treemap-closures.svg"),
    parts.join("\n"),
  );
  console.log("wrote docs/assets/treemap-closures.svg");
  return true;
}

/* ------------------------------------------------------------------ */

const sizeSvg = treemapSvg(
  "Library size on disk",
  "Engine package footprint, excluding the shared Deno runtime (native: JSR artifact; oxigraph: npm package; comunica: full transitive dependency closure)",
  sizeTree(),
);
Deno.writeTextFileSync(
  join(Deno.cwd(), "docs", "assets", "treemap-library-size.svg"),
  sizeSvg,
);

const memSvg = treemapSvg(
  "Peak heap during execution (10k-person graph)",
  "Isolated Deno subprocess per engine; peak Deno.memoryUsage().heapUsed over 5 runs; ~62 MiB runtime baseline excluded from comparison by symmetry",
  memoryTree(),
  720,
  300,
);
Deno.writeTextFileSync(
  join(Deno.cwd(), "docs", "assets", "treemap-memory.svg"),
  memSvg,
);

closuresChart();

console.log(
  "wrote docs/assets/treemap-library-size.svg and treemap-memory.svg",
);

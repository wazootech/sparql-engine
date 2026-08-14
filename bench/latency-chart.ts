// Latency bar-chart SVG generator for the README's three-engine latency
// comparison.
//
// Reads bench/latency-data.json (raw `deno bench --json` output from
// bench/engine_bench.ts) and writes:
//
//   docs/assets/chart-latency.svg
//
// Run: deno run --allow-read --allow-write bench/latency-chart.ts
import { join } from "@std/path";

interface BenchOk {
  ok: {
    n: number;
    min: number;
    max: number;
    avg: number;
    p75: number;
    p99: number;
  };
}

interface BenchEntry {
  group: string;
  name: string;
  baseline: boolean;
  results: BenchOk[];
}

interface LatencyData {
  version: number;
  runtime: string;
  benches: BenchEntry[];
}

const ENGINES = ["wazoo", "comunica", "oxigraph"] as const;
const ENGINE_COLORS: Record<string, string> = {
  wazoo: "#2f9e44",
  comunica: "#f08c00",
  oxigraph: "#1971c2",
};

/** Headline query classes, mirroring docs/07-benchmarking.md "Known results".
 * The asym/chain rows split by engine because the planner is wazoo-only:
 * comunica/oxigraph benches are named "- asym"/"- chain" (written order),
 * while wazoo registers "(reorder on)" and "(reorder off)" variants. */
interface Row {
  group: string;
  /** bench-name label per engine (after "<engine> - "). */
  labels: { wazoo: string; comunica: string; oxigraph: string };
  title: string;
}

interface Section {
  heading: string;
  rows: Row[];
}

const SAME = "";

const SECTIONS: Section[] = [
  {
    heading: "Core joins — 400-person graph",
    rows: [
      {
        group: "scan",
        labels: { wazoo: "scan", comunica: "scan", oxigraph: "scan" },
        title: "full scan",
      },
      {
        group: "join",
        labels: { wazoo: "join", comunica: "join", oxigraph: "join" },
        title: "join (knows × name)",
      },
      {
        group: "asym-join",
        labels: {
          wazoo: "asym (reorder on)",
          comunica: "asym",
          oxigraph: "asym",
        },
        title: "asymmetric join",
      },
      {
        group: "reorder-chain",
        labels: {
          wazoo: "chain (reorder off)",
          comunica: "chain",
          oxigraph: "chain",
        },
        title: "3-pattern chain, written order",
      },
      {
        group: "reorder-chain",
        labels: { wazoo: "chain (reorder on)", comunica: SAME, oxigraph: SAME },
        title: "3-pattern chain, planner on",
      },
      {
        group: "ask",
        labels: { wazoo: "ask", comunica: "ask", oxigraph: "ask" },
        title: "ASK",
      },
      {
        group: "construct",
        labels: {
          wazoo: "construct",
          comunica: "construct",
          oxigraph: "construct",
        },
        title: "CONSTRUCT",
      },
      {
        group: "update",
        labels: { wazoo: "update", comunica: "update", oxigraph: "update" },
        title: "UPDATE (self-restoring)",
      },
    ],
  },
  {
    heading: "EXISTS surface — 10k-person graph",
    rows: [
      {
        group: "exists-large",
        labels: { wazoo: "exists", comunica: "exists", oxigraph: "exists" },
        title: "FILTER EXISTS",
      },
      {
        group: "exists-large",
        labels: {
          wazoo: "not-exists",
          comunica: "not-exists",
          oxigraph: "not-exists",
        },
        title: "FILTER NOT EXISTS",
      },
      {
        group: "exists-large",
        labels: {
          wazoo: "nested-exists",
          comunica: "nested-exists",
          oxigraph: "nested-exists",
        },
        title: "nested EXISTS",
      },
      {
        group: "exists-large",
        labels: {
          wazoo: "nested-not-exists",
          comunica: "nested-not-exists",
          oxigraph: "nested-not-exists",
        },
        title: "nested NOT EXISTS",
      },
    ],
  },
  {
    heading: "Join surface — 10k-person graph",
    rows: [
      {
        group: "join-large",
        labels: { wazoo: "union", comunica: "union", oxigraph: "union" },
        title: "UNION (10k × 20k)",
      },
      {
        group: "join-large",
        labels: {
          wazoo: "optional",
          comunica: "optional",
          oxigraph: "optional",
        },
        title: "OPTIONAL (10k × 5k)",
      },
      {
        group: "join-large",
        labels: { wazoo: "minus", comunica: "minus", oxigraph: "minus" },
        title: "MINUS (10k × 5k)",
      },
    ],
  },
];

function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  );
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  if (ms >= 0.1) return `${ms.toFixed(2)} ms`;
  return `${(ms * 1000).toFixed(0)} µs`;
}

/** Average ms/iter for one engine's bench row, or undefined if missing. */
function rowMs(
  data: LatencyData,
  group: string,
  label: string,
  engine: string,
) {
  if (label === "") return undefined;
  const entry = data.benches.find(
    (b) => b.group === group && b.name === `${engine} - ${label}`,
  );
  const first = entry?.results[0];
  if (first === undefined || !("ok" in first)) return undefined;
  return first.ok.avg / 1e6; // ns -> ms
}

function chartSvg(data: LatencyData): string {
  const W = 780;
  const labelX = 190; // row titles
  const plotW = 440; // 190..630
  const valueX = 640; // value labels
  const rowH = 30;
  const barH = 7;
  const barGap = 9;

  // Per-row ms values, missing -> skipped row.
  const rows: Array<{ row: Row; ms: Array<number | undefined> }> = [];
  for (const section of SECTIONS) {
    for (const row of section.rows) {
      rows.push({
        row,
        ms: ENGINES.map((e) => rowMs(data, row.group, row.labels[e], e)),
      });
    }
  }
  const present = rows.filter((r) => r.ms.some((v) => v !== undefined));

  const titleH = 26;
  const legendH = 22;
  const headingH = 20;
  const captionH = 30;
  const totalH = titleH + legendH + headingH +
    present.reduce(
      (h, r) => h + (r.ms.every((v) => v === undefined) ? 0 : rowH),
      headingH * (SECTIONS.length - 1), // section headings between
    ) + captionH;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  // Title
  out.push(
    `<text x="12" y="18" font-size="14" font-weight="600" fill="#212529">Query latency by class</text>`,
  );
  // Legend
  let lx = 12;
  for (const engine of ENGINES) {
    out.push(
      `<rect x="${lx}" y="30" width="10" height="10" rx="2" fill="${
        ENGINE_COLORS[engine]
      }"/>`,
    );
    out.push(
      `<text x="${
        lx + 15
      }" y="39" font-size="11" fill="#495057">${engine}</text>`,
    );
    lx += 15 + 10 + engine.length * 6.5 + 16;
  }

  let y = titleH + legendH;
  for (const section of SECTIONS) {
    const sectionRows = present.filter(
      (r) => section.rows.includes(r.row),
    );
    if (sectionRows.length === 0) continue;
    out.push(
      `<text x="12" y="${
        y + 14
      }" font-size="11" font-weight="600" fill="#868e96">${
        esc(section.heading)
      }</text>`,
    );
    y += headingH;
    for (const { row, ms } of sectionRows) {
      const max = Math.max(...ms.filter((v): v is number => v !== undefined));
      out.push(
        `<text x="12" y="${y + 15}" font-size="10" fill="#343a40">${
          esc(row.title)
        }</text>`,
      );
      ENGINES.forEach((engine, i) => {
        const v = ms[i];
        if (v === undefined) return;
        const w = (v / max) * plotW;
        const barY = y + 6 + i * barGap;
        out.push(
          `<rect x="${labelX}" y="${barY}" width="${
            Math.max(w, 1)
          }" height="${barH}" rx="1.5" fill="${ENGINE_COLORS[engine]}"/>`,
        );
        out.push(
          `<text x="${valueX}" y="${
            barY + barH - 1
          }" font-size="9" fill="#495057">${fmtMs(v)}</text>`,
        );
      });
      y += rowH;
    }
  }

  // Caption
  out.push(
    `<text x="12" y="${
      totalH - 8
    }" font-size="9" fill="#868e96">Average ms per iteration, lower is better — each row normalized to its slowest engine; bars are not to scale across rows.</text>`,
  );
  out.push(
    `<text x="12" y="${totalH - 18}" font-size="9" fill="#adb5bd">Snapshot: ${
      esc(data.runtime)
    } — regenerate with \`deno task bench:latency\`.</text>`,
  );
  out.push(`</svg>`);
  return out.join("\n");
}

const data = JSON.parse(
  Deno.readTextFileSync(join(Deno.cwd(), "bench", "latency-data.json")),
) as LatencyData;
Deno.writeTextFileSync(
  join(Deno.cwd(), "docs", "assets", "chart-latency.svg"),
  chartSvg(data),
);
console.log("wrote docs/assets/chart-latency.svg");

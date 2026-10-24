// Dev only: draws fake screenshots as SVG so the pages can be tried in a
// normal browser (no Tauri). Served by the Vite dev server under /dev-shot/.

import type { Plugin } from "vite";
import { previewAppIcon } from "./app-icons.ts";

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const accents = ["#2f6fed", "#1f9d6c", "#d9482b", "#7b4ce0", "#d48a00", "#0e8fa8"];

/** A fake app window: title bar, sidebar, a heading and lines of text. */
export function fakeShot(seed: string, w: number, h: number): string {
  const n = hash(seed);
  const accent = accents[n % accents.length];
  const dark = n % 5 === 0;
  const bg = dark ? "#1e2127" : "#ffffff";
  const panel = dark ? "#262a31" : "#f3f5f8";
  const ink = dark ? "#d9dde3" : "#2b3038";
  const line = dark ? "#3a3f48" : "#dfe3e8";
  const side = Math.round(w * 0.22);
  const bar = Math.round(h * 0.07);
  let lines = "";
  const rows = 6 + (n % 5);
  for (let i = 0; i < rows; i++) {
    const y = bar + h * 0.2 + i * (h * 0.06);
    const len = (0.35 + ((n >> (i % 16)) % 40) / 100) * (w - side);
    lines += `<rect x="${side + w * 0.05}" y="${y}" width="${len}" height="${h * 0.022}" rx="3" fill="${line}"/>`;
  }
  let items = "";
  for (let i = 0; i < 6; i++) {
    items += `<rect x="${w * 0.02}" y="${bar + h * 0.05 + i * h * 0.08}" width="${side - w * 0.04}" height="${h * 0.045}" rx="4" fill="${i === n % 6 ? accent : line}" opacity="${i === n % 6 ? 0.9 : 0.6}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
<rect width="${w}" height="${bar}" fill="${panel}"/>
<circle cx="${bar * 0.6}" cy="${bar / 2}" r="${bar * 0.16}" fill="#ff5f57"/><circle cx="${bar * 1.1}" cy="${bar / 2}" r="${bar * 0.16}" fill="#febc2e"/><circle cx="${bar * 1.6}" cy="${bar / 2}" r="${bar * 0.16}" fill="#28c840"/>
<rect y="${bar}" width="${side}" height="${h - bar}" fill="${panel}"/>
${items}
<rect x="${side + w * 0.05}" y="${bar + h * 0.07}" width="${(w - side) * 0.45}" height="${h * 0.05}" rx="4" fill="${ink}" opacity="0.85"/>
${lines}
<rect x="${side + w * 0.05}" y="${h * 0.8}" width="${w * 0.16}" height="${h * 0.07}" rx="6" fill="${accent}"/>
</svg>`;
}

/** A fake desktop with a few windows, for the capture overlay. */
export function fakeDesktop(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b4c7e"/><stop offset="1" stop-color="#0f1c2e"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<g transform="translate(160 120)">${fakeShot("desk-a", 900, 600).replace(/<\/?svg[^>]*>/g, "")}</g>
<g transform="translate(980 300)">${fakeShot("desk-b", 760, 520).replace(/<\/?svg[^>]*>/g, "")}</g>
<rect y="${h - 48}" width="${w}" height="48" fill="#1b1f26" opacity="0.95"/>
</svg>`;
}

export function fakeShots(): Plugin {
  return {
    name: "fake-shots",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/dev-shot", (req, res) => {
        const path = (req.url ?? "").split("?")[0].replace(/^\//, "");
        const [kind, id, extra] = path.split("/");
        const appName = kind === "app-icon"
          ? new TextDecoder().decode(Uint8Array.from(id.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16)))
          : "";
        const svg = kind === "app-icon" ? previewAppIcon(appName)
          : kind === "frame" ? fakeDesktop(1920, 1080) : fakeShot(id + (extra ?? ""), 1600, 1000);
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(svg);
      });
    },
  };
}

// Picking words on the frozen screen after "copy text": the recognised
// words in reading order, the word a point is nearest to, and what a
// picked range copies as.

import type { Rect, TextLine } from "../shared/api";
import type { Pt } from "../shared/geometry";

export type PickWord = { text: string; rect: Rect; line: number };

/** The words in reading order, each knowing its line. */
export function flatten(lines: TextLine[]): PickWord[] {
  return lines.flatMap((l, line) => l.words.map((w) => ({ text: w.text, rect: w.rect, line })));
}

/** How far `v` is outside [from, to]; 0 inside. */
function gap(v: number, from: number, to: number): number {
  return v < from ? from - v : v > to ? v - to : 0;
}

/**
 * The word nearest to `p`: first the nearest line (by height, then along
 * it, so side-by-side columns work), then the nearest word on that line.
 * -1 when there are no words.
 */
export function wordNear(words: PickWord[], p: Pt): number {
  const lines = new Map<number, Rect & { r: number; b: number }>();
  for (const w of words) {
    const s = lines.get(w.line);
    const r = w.rect.x + w.rect.w;
    const b = w.rect.y + w.rect.h;
    if (!s) lines.set(w.line, { ...w.rect, r, b });
    else {
      s.x = Math.min(s.x, w.rect.x);
      s.y = Math.min(s.y, w.rect.y);
      s.r = Math.max(s.r, r);
      s.b = Math.max(s.b, b);
    }
  }
  let line = -1;
  let dy = Infinity;
  let dx = Infinity;
  for (const [n, s] of lines) {
    const y = gap(p.y, s.y, s.b);
    const x = gap(p.x, s.x, s.r);
    if (y < dy || (y === dy && x < dx)) {
      line = n;
      dy = y;
      dx = x;
    }
  }
  let best = -1;
  let dist = Infinity;
  words.forEach((w, i) => {
    if (w.line !== line) return;
    const d = gap(p.x, w.rect.x, w.rect.x + w.rect.w);
    if (d < dist) {
      best = i;
      dist = d;
    }
  });
  return best;
}

function ordered(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** What the picked words copy as: spaces within a line, a new line between lines. */
export function pickedText(words: PickWord[], a: number, b: number): string {
  const [from, to] = ordered(a, b);
  let out = "";
  for (let i = from; i <= to && i < words.length; i++) {
    if (i > from) out += words[i].line === words[i - 1].line ? " " : "\n";
    out += words[i].text;
  }
  return out;
}

/** One highlight band per line of the picked range, the gaps between words included. */
export function pickedBands(words: PickWord[], a: number, b: number): Rect[] {
  const [from, to] = ordered(a, b);
  const bands: Rect[] = [];
  let band: { line: number; x: number; y: number; r: number; b: number } | null = null;
  const flush = () => band && bands.push({ x: band.x, y: band.y, w: band.r - band.x, h: band.b - band.y });
  for (let i = from; i <= to && i < words.length; i++) {
    const { rect, line } = words[i];
    if (band && band.line === line) {
      band.x = Math.min(band.x, rect.x);
      band.y = Math.min(band.y, rect.y);
      band.r = Math.max(band.r, rect.x + rect.w);
      band.b = Math.max(band.b, rect.y + rect.h);
    } else {
      flush();
      band = { line, x: rect.x, y: rect.y, r: rect.x + rect.w, b: rect.y + rect.h };
    }
  }
  flush();
  return bands;
}

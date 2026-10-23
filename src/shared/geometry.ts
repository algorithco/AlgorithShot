// Rectangle math for selections, in physical pixels.

import type { Rect } from "./api";

export type Pt = { x: number; y: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const right = (r: Rect) => r.x + r.w;
export const bottom = (r: Rect) => r.y + r.h;

export function contains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < right(r) && p.y < bottom(r);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(right(a), right(b));
  const btm = Math.min(bottom(a), bottom(b));
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

/** The rectangle between two drag points, rounded to whole pixels.
 *  With `square`, the shorter side grows to match the longer one. */
export function fromPoints(a: Pt, b: Pt, square = false): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const x0 = Math.round(Math.min(a.x, a.x + dx));
  const y0 = Math.round(Math.min(a.y, a.y + dy));
  const x1 = Math.round(Math.max(a.x, a.x + dx));
  const y1 = Math.round(Math.max(a.y, a.y + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Moves `r` inside `bounds` without changing its size (shrinks only if it
 *  is bigger than the bounds). */
export function keepInside(r: Rect, bounds: Rect): Rect {
  const w = Math.min(r.w, bounds.w);
  const h = Math.min(r.h, bounds.h);
  const x = Math.min(Math.max(r.x, bounds.x), right(bounds) - w);
  const y = Math.min(Math.max(r.y, bounds.y), bottom(bounds) - h);
  return { x, y, w, h };
}

/** The closest line within `threshold` of `v`, or `v` itself. */
export function snap(v: number, lines: number[], threshold: number): number {
  let best = v;
  let bestDist = threshold + 1;
  for (const line of lines) {
    const d = Math.abs(line - v);
    if (d <= threshold && d < bestDist) {
      best = line;
      bestDist = d;
    }
  }
  return best;
}

/** Vertical and horizontal edge lines of some rectangles, for snapping. */
export function edges(rects: Rect[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rects) {
    xs.push(r.x, right(r));
    ys.push(r.y, bottom(r));
  }
  return { xs, ys };
}

/** Which resize handle (if any) is under `p`. `size` is the grab radius. */
export function handleAt(r: Rect, p: Pt, size: number): Handle | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= size;
  const inX = p.x >= r.x - size && p.x <= right(r) + size;
  const inY = p.y >= r.y - size && p.y <= bottom(r) + size;
  if (!inX || !inY) return null;
  const left = near(p.x, r.x);
  const rt = near(p.x, right(r));
  const top = near(p.y, r.y);
  const btm = near(p.y, bottom(r));
  if (top && left) return "nw";
  if (top && rt) return "ne";
  if (btm && left) return "sw";
  if (btm && rt) return "se";
  if (top) return "n";
  if (btm) return "s";
  if (left) return "w";
  if (rt) return "e";
  return null;
}

/** Drags one handle of `start` to `p`. The rectangle can flip over. */
export function resize(start: Rect, handle: Handle, p: Pt): Rect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = right(start);
  let y1 = bottom(start);
  if (handle.includes("w")) x0 = p.x;
  if (handle.includes("e")) x1 = p.x;
  if (handle.includes("n")) y0 = p.y;
  if (handle.includes("s")) y1 = p.y;
  return fromPoints({ x: x0, y: y0 }, { x: x1, y: y1 });
}

/** A frame of exactly w×h centred on `center`, kept inside `bounds`. */
export function frameAt(center: Pt, w: number, h: number, bounds: Rect): Rect {
  return keepInside({ x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h }, bounds);
}

/** Changes the size by (dw, dh) from the top-left corner, at least 1×1. */
export function grow(r: Rect, dw: number, dh: number, bounds: Rect): Rect {
  const w = Math.max(1, Math.min(r.w + dw, right(bounds) - r.x));
  const h = Math.max(1, Math.min(r.h + dh, bottom(bounds) - r.y));
  return { ...r, w, h };
}

export const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

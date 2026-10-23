// The editor's document: raster edits applied to the original in order
// ("ops"), annotation marks drawn on top, and the undo history.
// Marks are kept in the coordinates of the current image, so an op that
// changes the size (crop, cut, resize) moves the marks along with it.

import type { Rect } from "../shared/api";
import type { Pt } from "../shared/geometry";

export type HideStyle = "pixelate" | "blur" | "solid";
export type Axis = "horizontal" | "vertical";

/** How a resize or fit maps old pixels to new: new = old * s + o. */
export type Mapping = { sx: number; sy: number; ox: number; oy: number };

export type Op =
  | { kind: "crop"; rect: Rect }
  | { kind: "erase"; rect: Rect }
  | { kind: "eraseStroke"; points: Pt[]; size: number }
  | { kind: "patch"; at: Pt; image: ImageBitmap }
  | { kind: "cut"; axis: Axis; from: number; to: number }
  | { kind: "hide"; rect: Rect; style: HideStyle; strength: number }
  | { kind: "replace"; image: ImageBitmap; map: Mapping };

export type Mark =
  | { id: string; kind: "arrow"; a: Pt; b: Pt; color: string; width: number }
  | { id: string; kind: "box"; rect: Rect; color: string; width: number }
  | { id: string; kind: "highlight"; rect: Rect; color: string }
  | { id: string; kind: "text"; at: Pt; text: string; color: string; size: number }
  | { id: string; kind: "step"; at: Pt; n: number; color: string; size: number };

export type Doc = { width: number; height: number; ops: Op[]; marks: Mark[] };

export type History = { past: Doc[]; present: Doc; future: Doc[] };

export function newHistory(width: number, height: number): History {
  return { past: [], present: { width, height, ops: [], marks: [] }, future: [] };
}

export function commit(h: History, next: Doc): History {
  return { past: [...h.past.slice(-99), h.present], present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

/** The image size after an op. */
export function sizeAfter(w: number, h: number, op: Op): { w: number; h: number } {
  switch (op.kind) {
    case "crop":
      return { w: op.rect.w, h: op.rect.h };
    case "cut":
      return op.axis === "horizontal" ? { w, h: h - (op.to - op.from) } : { w: w - (op.to - op.from), h };
    case "replace":
      return { w: op.image.width, h: op.image.height };
    default:
      return { w, h };
  }
}

/** Where a point of the old image ends up after the op. */
export function movePoint(p: Pt, op: Op): Pt {
  switch (op.kind) {
    case "crop":
      return { x: p.x - op.rect.x, y: p.y - op.rect.y };
    case "cut": {
      const band = op.to - op.from;
      const v = op.axis === "horizontal" ? p.y : p.x;
      const moved = v >= op.to ? v - band : v > op.from ? op.from : v;
      return op.axis === "horizontal" ? { x: p.x, y: moved } : { x: moved, y: p.y };
    }
    case "replace":
      return { x: p.x * op.map.sx + op.map.ox, y: p.y * op.map.sy + op.map.oy };
    default:
      return p;
  }
}

function moveRect(r: Rect, op: Op): Rect {
  const a = movePoint({ x: r.x, y: r.y }, op);
  const b = movePoint({ x: r.x + r.w, y: r.y + r.h }, op);
  return { x: a.x, y: a.y, w: Math.max(0, b.x - a.x), h: Math.max(0, b.y - a.y) };
}

/** Moves (and for resizes, scales) the marks to follow a size-changing op. */
export function moveMarks(marks: Mark[], op: Op): Mark[] {
  if (op.kind !== "crop" && op.kind !== "cut" && op.kind !== "replace") return marks;
  const s = op.kind === "replace" ? (op.map.sx + op.map.sy) / 2 : 1;
  return marks.map((m): Mark => {
    switch (m.kind) {
      case "arrow":
        return { ...m, a: movePoint(m.a, op), b: movePoint(m.b, op), width: m.width * s };
      case "box":
        return { ...m, rect: moveRect(m.rect, op), width: m.width * s };
      case "highlight":
        return { ...m, rect: moveRect(m.rect, op) };
      case "text":
      case "step":
        return { ...m, at: movePoint(m.at, op), size: m.size * s };
    }
  });
}

/** A new document with `op` applied: size and marks updated. */
export function withOp(doc: Doc, op: Op): Doc {
  const { w, h } = sizeAfter(doc.width, doc.height, op);
  return { width: w, height: h, ops: [...doc.ops, op], marks: moveMarks(doc.marks, op) };
}

let nextId = 1;
export const markId = () => `m${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function nextStep(marks: Mark[]): number {
  return marks.reduce((n, m) => (m.kind === "step" ? Math.max(n, m.n) : n), 0) + 1;
}

/** The topmost mark under `p` (image coordinates), with some slack. */
export function markAt(marks: Mark[], p: Pt, slack: number): Mark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (hitMark(m, p, slack)) return m;
  }
  return null;
}

function hitMark(m: Mark, p: Pt, slack: number): boolean {
  switch (m.kind) {
    case "arrow":
      return distToSegment(p, m.a, m.b) <= Math.max(slack, m.width);
    case "box":
    case "highlight": {
      const r = m.rect;
      const inside = p.x >= r.x - slack && p.x <= r.x + r.w + slack && p.y >= r.y - slack && p.y <= r.y + r.h + slack;
      if (m.kind === "highlight") return inside;
      const innerHit = p.x > r.x + slack && p.x < r.x + r.w - slack && p.y > r.y + slack && p.y < r.y + r.h - slack;
      return inside && !innerHit;
    }
    case "text": {
      const lines = m.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * m.size * 0.6;
      const h = lines.length * m.size * 1.25;
      return p.x >= m.at.x - slack && p.x <= m.at.x + w + slack && p.y >= m.at.y - slack && p.y <= m.at.y + h + slack;
    }
    case "step":
      return Math.hypot(p.x - m.at.x, p.y - m.at.y) <= m.size / 2 + slack;
  }
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Moves a mark by (dx, dy). */
export function shiftMark(m: Mark, dx: number, dy: number): Mark {
  switch (m.kind) {
    case "arrow":
      return { ...m, a: { x: m.a.x + dx, y: m.a.y + dy }, b: { x: m.b.x + dx, y: m.b.y + dy } };
    case "box":
    case "highlight":
      return { ...m, rect: { ...m.rect, x: m.rect.x + dx, y: m.rect.y + dy } };
    case "text":
    case "step":
      return { ...m, at: { x: m.at.x + dx, y: m.at.y + dy } };
  }
}

/** Preset output sizes for "perfect size". */
export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Full HD", w: 1920, h: 1080 },
  { label: "HD", w: 1280, h: 720 },
  { label: "Instagram post", w: 1080, h: 1080 },
  { label: "Instagram portrait", w: 1080, h: 1350 },
  { label: "Story / Reels", w: 1080, h: 1920 },
  { label: "Telegram post", w: 1280, h: 960 },
  { label: "Link preview", w: 1200, h: 630 },
  { label: "X / Twitter", w: 1200, h: 675 },
  { label: "YouTube thumbnail", w: 1280, h: 720 },
];

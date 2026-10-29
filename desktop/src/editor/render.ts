// Drawing for the editor: applying raster ops to canvases, drawing marks,
// and producing the final pixels to save.

import type { Rect } from "../shared/api";
import { context2d, createCanvas, type RasterCanvas } from "../shared/canvas";
import type { HideStyle, Mark, Op } from "./doc";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function blank(w: number, h: number): RasterCanvas {
  return createCanvas(w, h);
}

function clone(src: RasterCanvas): RasterCanvas {
  const c = blank(src.width, src.height);
  context2d(c).drawImage(src, 0, 0);
  return c;
}

export function fromBitmap(img: ImageBitmap): RasterCanvas {
  const c = blank(img.width, img.height);
  context2d(c).drawImage(img, 0, 0);
  return c;
}

export function applyOp(src: RasterCanvas, op: Op): RasterCanvas {
  switch (op.kind) {
    case "crop": {
      const c = blank(op.rect.w, op.rect.h);
      context2d(c).drawImage(src, -op.rect.x, -op.rect.y);
      return c;
    }
    case "erase": {
      const c = clone(src);
      context2d(c).clearRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
      return c;
    }
    case "eraseStroke": {
      const c = clone(src);
      const ctx = context2d(c);
      ctx.globalCompositeOperation = "destination-out";
      strokePath(ctx, op.points, op.size, "#000");
      return c;
    }
    case "patch": {
      const c = clone(src);
      const ctx = context2d(c);
      ctx.clearRect(op.at.x, op.at.y, op.image.width, op.image.height);
      ctx.drawImage(op.image, op.at.x, op.at.y);
      return c;
    }
    case "cut": {
      const band = op.to - op.from;
      if (op.axis === "horizontal") {
        const c = blank(src.width, src.height - band);
        const ctx = context2d(c);
        ctx.drawImage(src, 0, 0, src.width, op.from, 0, 0, src.width, op.from);
        ctx.drawImage(src, 0, op.to, src.width, src.height - op.to, 0, op.from, src.width, src.height - op.to);
        return c;
      }
      const c = blank(src.width - band, src.height);
      const ctx = context2d(c);
      ctx.drawImage(src, 0, 0, op.from, src.height, 0, 0, op.from, src.height);
      ctx.drawImage(src, op.to, 0, src.width - op.to, src.height, op.from, 0, src.width - op.to, src.height);
      return c;
    }
    case "hide": {
      const c = clone(src);
      hide(context2d(c), src, op.rect, op.style, op.strength);
      return c;
    }
    case "rasterize":
      return flatten(src, op.marks);
    case "replace":
      return fromBitmap(op.image);
  }
}

/** Covers private data. Pixelate and solid can't be undone by "un-blurring". */
function hide(ctx: Ctx, src: RasterCanvas, r: Rect, style: HideStyle, strength: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (style === "solid") {
    ctx.fillStyle = "#111111";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else if (style === "blur" && "filter" in ctx) {
    ctx.filter = `blur(${Math.max(2, strength)}px)`;
    ctx.drawImage(src, 0, 0);
  } else {
    const block = Math.max(4, Math.round(strength));
    const sw = Math.max(1, Math.ceil(r.w / block));
    const sh = Math.max(1, Math.ceil(r.h / block));
    const small = blank(sw, sh);
    const sctx = context2d(small);
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, r.x, r.y, sw * block, sh * block, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, sw * block, sh * block);
  }
  ctx.restore();
}

function strokePath(ctx: Ctx, points: { x: number; y: number }[], size: number, color: string, smooth = true) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // One complete path per stroke keeps translucent ink uniform at overlaps.
  // Midpoint curves remove sharp sample-to-sample corners while still ending
  // exactly at the pointer's final position.
  if (smooth && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }
  } else {
    for (let i = 1; i < points.length - 1; i++) ctx.lineTo(points[i].x, points[i].y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Applies ops to the original, reusing the results of earlier renders: adding
 * one op only applies that op, and undo goes back to a cached step.
 */
export class BaseRenderer {
  private ops: Op[] = [];
  private cache = new Map<number, { canvas: RasterCanvas; used: number }>();
  private cachedBytes = 0;
  private clock = 0;

  constructor(original: ImageBitmap, private readonly cacheBudgetBytes = 128 * 1024 * 1024) {
    this.remember(0, fromBitmap(original));
  }

  render(ops: Op[]): RasterCanvas {
    // How many leading ops are unchanged since the last render.
    let same = 0;
    while (same < ops.length && same < this.ops.length && this.ops[same] === ops[same]) same++;
    this.ops = ops;

    // An undo or a new branch invalidates later snapshots. The original is
    // always retained, so every discarded snapshot can be replayed exactly.
    for (const [index, entry] of this.cache) {
      if (index > same) {
        this.cachedBytes -= this.bytes(entry.canvas);
        this.cache.delete(index);
      }
    }

    let start = 0;
    for (const index of this.cache.keys()) if (index <= same) start = Math.max(start, index);
    const checkpoint = this.cache.get(start)!;
    checkpoint.used = ++this.clock;
    let canvas = checkpoint.canvas;
    for (let i = start; i < ops.length; i++) {
      canvas = applyOp(canvas, ops[i]);
      this.remember(i + 1, canvas);
    }
    return canvas;
  }

  private bytes(canvas: RasterCanvas): number {
    return canvas.width * canvas.height * 4;
  }

  private remember(index: number, canvas: RasterCanvas) {
    const previous = this.cache.get(index);
    if (previous) this.cachedBytes -= this.bytes(previous.canvas);
    this.cache.set(index, { canvas, used: ++this.clock });
    this.cachedBytes += this.bytes(canvas);

    // Each 4K snapshot costs about 32 MiB. A fixed count or permanent every-
    // eighth checkpoint grows too large for long editing sessions. Evict
    // during replay as well, rather than retaining every intermediate frame.
    while (this.cachedBytes > this.cacheBudgetBytes || this.cache.size > 12) {
      let oldest: number | undefined;
      for (const [candidate, entry] of this.cache) {
        if (candidate === 0 || candidate === index) continue;
        if (oldest === undefined || entry.used < this.cache.get(oldest)!.used) oldest = candidate;
      }
      // Original and current are unavoidable, even for images over budget.
      if (oldest === undefined) break;
      this.cachedBytes -= this.bytes(this.cache.get(oldest)!.canvas);
      this.cache.delete(oldest);
    }
  }
}

// ---- marks ----

export const MARK_FONT = `"Segoe UI Variable Text", "Segoe UI", sans-serif`;

export function drawMarks(ctx: Ctx, marks: Mark[], skip?: string) {
  for (const m of marks) if (m.id !== skip) drawMark(ctx, m);
}

export function drawMark(ctx: Ctx, m: Mark) {
  ctx.save();
  if (m.kind === "arrow" || m.kind === "text" || m.kind === "step") {
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
  }
  if ("opacity" in m) ctx.globalAlpha = Math.max(0, Math.min(1, m.opacity ?? 1));
  switch (m.kind) {
    case "stroke":
      strokePath(ctx, m.points, m.width, m.color, m.tool !== "pencil");
      break;
    case "line":
      strokePath(ctx, [m.a, m.b], m.width, m.color);
      break;
    case "arrow": {
      const ang = Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x);
      const head = Math.max(12, m.width * 3.4);
      const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
      const shaftEnd = Math.max(0, len - head * 0.7);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(m.a.x, m.a.y);
      ctx.lineTo(m.a.x + Math.cos(ang) * shaftEnd, m.a.y + Math.sin(ang) * shaftEnd);
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(m.b.x, m.b.y);
      ctx.lineTo(m.b.x - head * Math.cos(ang - 0.42), m.b.y - head * Math.sin(ang - 0.42));
      ctx.lineTo(m.b.x - head * Math.cos(ang + 0.42), m.b.y - head * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "box":
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.rect(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
      if (m.fill) {
        ctx.fillStyle = m.color;
        ctx.fill();
      } else ctx.stroke();
      break;
    case "ellipse":
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.beginPath();
      ctx.ellipse(m.rect.x + m.rect.w / 2, m.rect.y + m.rect.h / 2, m.rect.w / 2, m.rect.h / 2, 0, 0, Math.PI * 2);
      if (m.fill) ctx.fill();
      else ctx.stroke();
      break;
    case "highlight":
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = m.color;
      ctx.globalAlpha = m.opacity ?? 0.55;
      ctx.fillRect(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
      break;
    case "text": {
      ctx.font = `600 ${m.size}px ${MARK_FONT}`;
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      const light = luminance(m.color) > 0.6;
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = light ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, m.size * 0.16);
      m.text.split("\n").forEach((line, i) => {
        const y = m.at.y + i * m.size * 1.25;
        ctx.strokeText(line, m.at.x, y);
        ctx.fillStyle = m.color;
        ctx.fillText(line, m.at.x, y);
      });
      break;
    }
    case "step": {
      const r = m.size / 2;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.at.x, m.at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = Math.max(1.5, m.size * 0.07);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = luminance(m.color) > 0.6 ? "#111111" : "#ffffff";
      ctx.font = `700 ${Math.round(m.size * 0.55)}px "Segoe UI Variable Display", ${MARK_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(m.n), m.at.x, m.at.y + m.size * 0.03);
      break;
    }
  }
  ctx.restore();
}

/** Bounding box of a mark, for selection outlines. */
export function markBounds(m: Mark, ctx?: Ctx): Rect {
  switch (m.kind) {
    case "stroke": {
      if (!m.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of m.points) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      const pad = m.width / 2;
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    case "line": {
      const pad = m.width / 2;
      return { x: Math.min(m.a.x, m.b.x) - pad, y: Math.min(m.a.y, m.b.y) - pad, w: Math.abs(m.b.x - m.a.x) + pad * 2, h: Math.abs(m.b.y - m.a.y) + pad * 2 };
    }
    case "arrow": {
      const pad = m.width * 3;
      const x = Math.min(m.a.x, m.b.x) - pad;
      const y = Math.min(m.a.y, m.b.y) - pad;
      return { x, y, w: Math.abs(m.b.x - m.a.x) + pad * 2, h: Math.abs(m.b.y - m.a.y) + pad * 2 };
    }
    case "box":
    case "ellipse":
    case "highlight":
      return m.rect;
    case "text": {
      const lines = m.text.split("\n");
      let w = Math.max(...lines.map((l) => l.length)) * m.size * 0.6;
      if (ctx) {
        ctx.save();
        ctx.font = `600 ${m.size}px ${MARK_FONT}`;
        w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        ctx.restore();
      }
      return { x: m.at.x, y: m.at.y, w, h: lines.length * m.size * 1.25 };
    }
    case "step":
      return { x: m.at.x - m.size / 2, y: m.at.y - m.size / 2, w: m.size, h: m.size };
  }
}

function luminance(hex: string): number {
  const v = parseInt(hex.replace("#", ""), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Base plus marks, as the final image. */
export function flatten(base: RasterCanvas, marks: Mark[]): RasterCanvas {
  const c = clone(base);
  const ctx = context2d(c);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, c.width, c.height);
  ctx.clip();
  drawMarks(ctx, marks);
  ctx.restore();
  return c;
}

export function rgbaOf(canvas: RasterCanvas, r?: Rect): Uint8Array {
  const area = r ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const data = context2d(canvas).getImageData(area.x, area.y, area.w, area.h).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function bitmapFromRgba(rgba: ArrayBuffer, w: number, h: number): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), w, h));
}

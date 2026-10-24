// Drawing for the editor: applying raster ops to canvases, drawing marks,
// and producing the final pixels to save.

import type { Rect } from "../shared/api";
import type { HideStyle, Mark, Op } from "./doc";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function blank(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function clone(src: OffscreenCanvas): OffscreenCanvas {
  const c = blank(src.width, src.height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

export function fromBitmap(img: ImageBitmap): OffscreenCanvas {
  const c = blank(img.width, img.height);
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

export function applyOp(src: OffscreenCanvas, op: Op): OffscreenCanvas {
  switch (op.kind) {
    case "crop": {
      const c = blank(op.rect.w, op.rect.h);
      c.getContext("2d")!.drawImage(src, -op.rect.x, -op.rect.y);
      return c;
    }
    case "erase": {
      const c = clone(src);
      c.getContext("2d")!.clearRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
      return c;
    }
    case "eraseStroke": {
      const c = clone(src);
      const ctx = c.getContext("2d")!;
      ctx.globalCompositeOperation = "destination-out";
      strokePath(ctx, op.points, op.size, "#000");
      return c;
    }
    case "patch": {
      const c = clone(src);
      const ctx = c.getContext("2d")!;
      ctx.clearRect(op.at.x, op.at.y, op.image.width, op.image.height);
      ctx.drawImage(op.image, op.at.x, op.at.y);
      return c;
    }
    case "cut": {
      const band = op.to - op.from;
      if (op.axis === "horizontal") {
        const c = blank(src.width, src.height - band);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(src, 0, 0, src.width, op.from, 0, 0, src.width, op.from);
        ctx.drawImage(src, 0, op.to, src.width, src.height - op.to, 0, op.from, src.width, src.height - op.to);
        return c;
      }
      const c = blank(src.width - band, src.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(src, 0, 0, op.from, src.height, 0, 0, op.from, src.height);
      ctx.drawImage(src, op.to, 0, src.width - op.to, src.height, op.from, 0, src.width - op.to, src.height);
      return c;
    }
    case "hide": {
      const c = clone(src);
      hide(c.getContext("2d")!, src, op.rect, op.style, op.strength);
      return c;
    }
    case "replace":
      return fromBitmap(op.image);
  }
}

/** Covers private data. Pixelate and solid can't be undone by "un-blurring". */
function hide(ctx: Ctx, src: OffscreenCanvas, r: Rect, style: HideStyle, strength: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  if (style === "solid") {
    ctx.fillStyle = "#111111";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else if (style === "blur") {
    ctx.filter = `blur(${Math.max(2, strength)}px)`;
    ctx.drawImage(src, 0, 0);
  } else {
    const block = Math.max(4, Math.round(strength));
    const sw = Math.max(1, Math.ceil(r.w / block));
    const sh = Math.max(1, Math.ceil(r.h / block));
    const small = blank(sw, sh);
    const sctx = small.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, r.x, r.y, sw * block, sh * block, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, sw * block, sh * block);
  }
  ctx.restore();
}

function strokePath(ctx: Ctx, points: { x: number; y: number }[], size: number, color: string) {
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
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/**
 * Applies ops to the original, reusing the results of earlier renders: adding
 * one op only applies that op, and undo goes back to a cached step.
 */
export class BaseRenderer {
  private steps: { op: Op | null; canvas: OffscreenCanvas | null }[];

  constructor(original: ImageBitmap) {
    this.steps = [{ op: null, canvas: fromBitmap(original) }];
  }

  render(ops: Op[]): OffscreenCanvas {
    // How many leading ops are unchanged since the last render.
    let same = 0;
    while (same < ops.length && same + 1 < this.steps.length && this.steps[same + 1].op === ops[same]) same++;
    this.steps.length = same + 1;

    // Start from the latest step that still has its canvas.
    let k = same;
    while (!this.steps[k].canvas) k--;
    let canvas = this.steps[k].canvas!;
    for (let i = k + 1; i <= same; i++) {
      canvas = applyOp(canvas, this.steps[i].op!);
      this.steps[i].canvas = canvas;
    }
    for (let i = same; i < ops.length; i++) {
      canvas = applyOp(canvas, ops[i]);
      this.steps.push({ op: ops[i], canvas });
    }

    // Keep the original, the last 10 results and every 8th as a checkpoint.
    const keepFrom = this.steps.length - 10;
    for (let i = 1; i < keepFrom; i++) if (i % 8 !== 0) this.steps[i].canvas = null;
    return canvas;
  }
}

// ---- marks ----

export const MARK_FONT = `"Segoe UI Variable Text", "Segoe UI", sans-serif`;

export function drawMarks(ctx: Ctx, marks: Mark[], skip?: string) {
  for (const m of marks) if (m.id !== skip) drawMark(ctx, m);
}

export function drawMark(ctx: Ctx, m: Mark) {
  ctx.save();
  if (m.kind !== "highlight") {
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
  }
  switch (m.kind) {
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
      ctx.roundRect(m.rect.x, m.rect.y, m.rect.w, m.rect.h, Math.min(m.width * 1.5, 10));
      ctx.stroke();
      break;
    case "highlight":
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = m.color;
      ctx.globalAlpha = 0.55;
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
    case "arrow": {
      const pad = m.width * 3;
      const x = Math.min(m.a.x, m.b.x) - pad;
      const y = Math.min(m.a.y, m.b.y) - pad;
      return { x, y, w: Math.abs(m.b.x - m.a.x) + pad * 2, h: Math.abs(m.b.y - m.a.y) + pad * 2 };
    }
    case "box":
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
export function flatten(base: OffscreenCanvas, marks: Mark[]): OffscreenCanvas {
  const c = clone(base);
  drawMarks(c.getContext("2d")!, marks);
  return c;
}

export function rgbaOf(canvas: OffscreenCanvas, r?: Rect): Uint8Array {
  const area = r ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const data = canvas.getContext("2d")!.getImageData(area.x, area.y, area.w, area.h).data;
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function bitmapFromRgba(rgba: ArrayBuffer, w: number, h: number): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), w, h));
}

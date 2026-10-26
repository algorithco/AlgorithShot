import type { Rect } from "../shared/api";
import type { Handle, Pt } from "../shared/geometry";

type Bounds = { w: number; h: number };
type CropMode = Handle | "move" | "new";

const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const validRatio = (ratio?: number | null) => ratio != null && Number.isFinite(ratio) && ratio > 0 ? ratio : null;
const limits = (bounds: Bounds): Bounds => ({ w: Math.max(1, Math.floor(finite(bounds.w, 1))), h: Math.max(1, Math.floor(finite(bounds.h, 1))) });

/** Round once, after constraining both dimensions, so clipping never breaks a ratio. */
function dimensions(w: number, h: number, maxW: number, maxH: number, ratio: number | null): Bounds {
  // A fixed ratio becomes approximate after rounding to whole image pixels.
  // Accept either rounded dimension; re-fitting an existing crop must not
  // repeatedly shave a pixel off the side that rounded upward.
  if (ratio && Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= maxW && h <= maxH &&
    (Math.abs(h - w / ratio) <= 0.5 + Number.EPSILON * Math.max(w, h) || Math.abs(w - h * ratio) <= 0.5 + Number.EPSILON * Math.max(w, h))) {
    return { w, h };
  }
  if (ratio) {
    w = Math.min(w, h * ratio, maxW, maxH * ratio);
    h = w / ratio;
  }
  return {
    w: clamp(Math.round(finite(w, 1)), 1, Math.max(1, Math.floor(maxW))),
    h: clamp(Math.round(finite(h, 1)), 1, Math.max(1, Math.floor(maxH))),
  };
}

function position(x: number, y: number, size: Bounds, bounds: Bounds): Rect {
  return {
    x: clamp(Math.round(finite(x, 0)), 0, bounds.w - size.w),
    y: clamp(Math.round(finite(y, 0)), 0, bounds.h - size.h),
    ...size,
  };
}

/** Fit an integer crop inside the image, retaining its center where possible. */
export function fitCrop(rect: Rect, image: Bounds, ratio?: number | null): Rect {
  const bounds = limits(image);
  const w = Math.max(1, finite(rect.w, 1));
  const h = Math.max(1, finite(rect.h, 1));
  const size = dimensions(w, h, bounds.w, bounds.h, validRatio(ratio));
  return position(rect.x + (w - size.w) / 2, rect.y + (h - size.h) / 2, size, bounds);
}

/** Apply a numeric size without allowing the far edge to leave the image. */
export function sizeCrop(rect: Rect, value: number, axis: "w" | "h", image: Bounds, ratio?: number | null): Rect {
  const bounds = limits(image);
  const r = validRatio(ratio);
  const n = Math.max(1, finite(value, rect[axis]));
  const w = axis === "w" ? n : r ? n * r : rect.w;
  const h = axis === "h" ? n : r ? n / r : rect.h;
  const size = dimensions(w, h, bounds.w, bounds.h, r);
  return position(rect.x, rect.y, size, bounds);
}

/** Resize from an anchored corner, including dragging past that corner. */
function corner(anchor: Pt, pointer: Pt, bounds: Bounds, ratio: number | null, fallbackX = 1, fallbackY = 1): Rect {
  const sx = Math.sign(pointer.x - anchor.x) || fallbackX;
  const sy = Math.sign(pointer.y - anchor.y) || fallbackY;
  const maxW = sx > 0 ? bounds.w - anchor.x : anchor.x;
  const maxH = sy > 0 ? bounds.h - anchor.y : anchor.y;
  let w = Math.abs(pointer.x - anchor.x);
  let h = Math.abs(pointer.y - anchor.y);
  if (ratio) {
    // The dominant axis follows the pointer; the other axis follows the ratio.
    w = Math.max(w, h * ratio);
    h = w / ratio;
  }
  const size = dimensions(w, h, maxW, maxH, ratio);
  return position(sx > 0 ? anchor.x : anchor.x - size.w, sy > 0 ? anchor.y : anchor.y - size.h, size, bounds);
}

/** Crop gestures share the same bounds and ratio rules as the numeric controls. */
export function dragCrop(original: Rect, mode: CropMode, start: Pt, pointer: Pt, image: Bounds, ratio: number | null): Rect {
  const bounds = limits(image);
  const orig = fitCrop(original, bounds);
  const r = validRatio(ratio);
  const pt = { x: clamp(finite(pointer.x, 0), 0, bounds.w), y: clamp(finite(pointer.y, 0), 0, bounds.h) };
  if (mode === "move") {
    return position(orig.x + pt.x - start.x, orig.y + pt.y - start.y, { w: orig.w, h: orig.h }, bounds);
  }
  if (mode === "new") {
    const anchor = { x: Math.round(clamp(finite(start.x, 0), 0, bounds.w)), y: Math.round(clamp(finite(start.y, 0), 0, bounds.h)) };
    return corner(anchor, pt, bounds, r);
  }
  const horizontal = mode.includes("w") || mode.includes("e");
  const vertical = mode.includes("n") || mode.includes("s");
  const anchorX = mode.includes("w") ? orig.x + orig.w : orig.x;
  const anchorY = mode.includes("n") ? orig.y + orig.h : orig.y;
  if (horizontal && vertical) {
    return corner({ x: anchorX, y: anchorY }, pt, bounds, r, mode.includes("w") ? -1 : 1, mode.includes("n") ? -1 : 1);
  }
  if (horizontal) {
    const sx = Math.sign(pt.x - anchorX) || (mode === "w" ? -1 : 1);
    const maxW = sx > 0 ? bounds.w - anchorX : anchorX;
    const centerY = orig.y + orig.h / 2;
    const maxH = r ? 2 * Math.min(centerY, bounds.h - centerY) : orig.h;
    const w = Math.abs(pt.x - anchorX);
    const size = dimensions(w, r ? w / r : orig.h, maxW, maxH, r);
    return position(sx > 0 ? anchorX : anchorX - size.w, centerY - size.h / 2, size, bounds);
  }
  const sy = Math.sign(pt.y - anchorY) || (mode === "n" ? -1 : 1);
  const maxH = sy > 0 ? bounds.h - anchorY : anchorY;
  const centerX = orig.x + orig.w / 2;
  const maxW = r ? 2 * Math.min(centerX, bounds.w - centerX) : orig.w;
  const h = Math.abs(pt.y - anchorY);
  const size = dimensions(r ? h * r : orig.w, h, maxW, maxH, r);
  return position(centerX - size.w / 2, sy > 0 ? anchorY : anchorY - size.h, size, bounds);
}

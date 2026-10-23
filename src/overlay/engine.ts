// The capture overlay's canvas: draws the frozen screen, the dimming, the
// selection with its viewfinder corners, the magnifier and the ruler, and
// turns mouse and keyboard input into a selection. Everything is in
// physical pixels; `ratio` converts from CSS pixels.

import type { CommitAction, Rect, WindowInfo } from "../shared/api";
import {
  bottom,
  contains,
  edges,
  frameAt,
  fromPoints,
  grow,
  handleAt,
  intersect,
  keepInside,
  resize,
  right,
  sameRect,
  snap,
  type Handle,
  type Pt,
} from "../shared/geometry";

export type Mode = "region" | "window" | "screen" | "fixed" | "text" | "qr" | "color" | "ruler";
export type Phase = "idle" | "press" | "draw" | "selected" | "move" | "resize" | "measure";

export type Element = { rect: Rect; name: string };

/** What the React chrome needs to know. */
export type View = {
  mode: Mode;
  phase: Phase;
  sel: Rect | null;
  hover: Rect | null;
  hoverLabel: string;
  ratio: number;
  width: number;
  height: number;
};

export type Callbacks = {
  change(view: View): void;
  commit(rect: Rect, action: CommitAction): void;
  cancel(): void;
  color(hex: string): void;
  /** Ask for the UI elements under a point (answered with setElements). */
  elementsAt?(p: Pt): void;
};

export type LoadArgs = {
  bitmap: ImageBitmap;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  windows: WindowInfo[];
  mode: Mode;
  cursor: [number, number] | null;
  magnifier: boolean;
  snap: boolean;
};

const TALLY = "#ffb400";
const DIM = "rgba(8, 10, 14, 0.5)";
const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export class Engine {
  width = 0;
  height = 0;
  ratio = 1;
  mode: Mode = "region";
  phase: Phase = "idle";
  sel: Rect | null = null;
  fixed = { w: 1280, h: 720 };
  magnifier = true;
  snapOn = true;

  private ctx: CanvasRenderingContext2D;
  private bitmap: ImageBitmap | null = null;
  private pixels: Uint8ClampedArray | null = null;
  private windows: WindowInfo[] = [];
  private elements: Element[] = [];
  private level = 0;
  private hover: Rect | null = null;
  private hoverLabel = "";
  private cursor: Pt = { x: -100, y: -100 };
  private anchor: Pt = { x: 0, y: 0 };
  private start: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private handle: Handle = "se";
  private grab: Pt = { x: 0, y: 0 };
  private ruler: { a: Pt; b: Pt } | null = null;
  private shift = false;
  private alt = false;
  private frame = 0;
  private lastView = "";
  private lines: { xs: number[]; ys: number[] } = { xs: [], ys: [] };

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: Callbacks,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  get bounds(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  load(a: LoadArgs) {
    this.bitmap?.close();
    this.bitmap = a.bitmap;
    this.pixels = a.pixels;
    this.width = a.width;
    this.height = a.height;
    this.canvas.width = a.width;
    this.canvas.height = a.height;
    this.ratio = a.width / Math.max(1, window.innerWidth);
    this.windows = a.windows;
    this.magnifier = a.magnifier;
    this.snapOn = a.snap;
    this.elements = [];
    this.level = 0;
    this.ruler = null;
    this.cursor = a.cursor ? { x: a.cursor[0], y: a.cursor[1] } : { x: -100, y: -100 };
    const visible = this.windows.map((w) => intersect(w.rect, this.bounds)).filter((r): r is Rect => !!r);
    this.lines = edges([this.bounds, ...visible]);
    this.setMode(a.mode);
    this.draw();
  }

  /** Forgets the frozen screen and leaves a transparent canvas. */
  clear() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.bitmap?.close();
    this.bitmap = null;
    this.pixels = null;
    this.sel = null;
    this.hover = null;
    this.ruler = null;
    this.phase = "idle";
    this.lastView = "";
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  get loaded() {
    return !!this.bitmap;
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.sel = null;
    this.ruler = null;
    this.phase = "idle";
    this.updateHover();
    this.changed();
  }

  setFixed(w: number, h: number) {
    this.fixed = { w: Math.max(1, Math.min(w, this.width)), h: Math.max(1, Math.min(h, this.height)) };
    this.setMode("fixed");
  }

  /** Sets an exact size for the current selection, keeping its corner. */
  setSize(w: number, h: number) {
    if (!this.sel) return;
    this.sel = keepInside({ ...this.sel, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }, this.bounds);
    this.phase = "selected";
    this.changed();
  }

  /** Elements under the cursor from UI Automation, smallest first. */
  setElements(elements: Element[], at: Pt) {
    if (this.phase !== "idle" || Math.hypot(at.x - this.cursor.x, at.y - this.cursor.y) > 40 * this.ratio) return;
    const visible = elements
      .map((e) => ({ ...e, rect: intersect(e.rect, this.bounds) }))
      .filter((e): e is Element => !!e.rect && e.rect.w >= 4 && e.rect.h >= 4);
    const same = visible.length === this.elements.length && visible.every((e, i) => sameRect(e.rect, this.elements[i].rect));
    if (same) return;
    this.elements = visible;
    this.level = 0;
    this.updateHover();
    this.changed();
  }

  // ---- input ----

  private pt(e: MouseEvent): Pt {
    return {
      x: Math.min(Math.max(e.clientX * this.ratio, 0), this.width),
      y: Math.min(Math.max(e.clientY * this.ratio, 0), this.height),
    };
  }

  down(e: PointerEvent) {
    if (e.button !== 0 || !this.bitmap) return;
    const p = this.pt(e);
    this.cursor = p;
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    this.canvas.setPointerCapture(e.pointerId);

    if (this.mode === "color") {
      this.cb.color(this.colorAt(p));
      return;
    }
    if (this.mode === "ruler") {
      this.phase = "measure";
      this.ruler = { a: p, b: p };
      this.changed();
      return;
    }
    if (this.phase === "selected" && this.sel) {
      const h = handleAt(this.sel, p, 8 * this.ratio);
      if (h) {
        this.phase = "resize";
        this.handle = h;
        this.start = { ...this.sel };
        this.changed();
        return;
      }
      if (contains(this.sel, p)) {
        this.phase = "move";
        this.grab = { x: p.x - this.sel.x, y: p.y - this.sel.y };
        this.start = { ...this.sel };
        this.changed();
        return;
      }
    }
    if (this.mode === "screen") {
      this.cb.commit(this.bounds, "done");
      return;
    }
    if (this.mode === "fixed") {
      this.sel = frameAt(p, this.fixed.w, this.fixed.h, this.bounds);
      this.phase = "selected";
      this.changed();
      return;
    }
    this.phase = "press";
    this.anchor = this.snapPoint(p);
    this.changed();
  }

  move(e: PointerEvent) {
    if (!this.bitmap) return;
    const p = this.pt(e);
    this.cursor = p;
    this.shift = e.shiftKey;
    this.alt = e.altKey;
    if (this.phase === "press" && Math.hypot(p.x - this.anchor.x, p.y - this.anchor.y) >= 4 * this.ratio) {
      this.phase = "draw";
    }
    switch (this.phase) {
      case "draw": {
        const r = fromPoints(this.anchor, this.snapPoint(p), this.shift);
        this.sel = intersect(r, this.bounds) ?? r;
        break;
      }
      case "move": {
        const moved = keepInside({ ...this.start, x: Math.round(p.x - this.grab.x), y: Math.round(p.y - this.grab.y) }, this.bounds);
        this.sel = this.snapMove(moved);
        break;
      }
      case "resize": {
        let r = resize(this.start, this.handle, this.snapPoint(p));
        if (this.shift && this.handle.length === 2) r = keepRatio(r, this.start, this.handle);
        this.sel = intersect(r, this.bounds) ?? r;
        break;
      }
      case "measure":
        if (this.ruler) this.ruler.b = p;
        break;
      case "idle":
        this.updateHover();
        if (this.mode === "region" || this.mode === "text" || this.mode === "qr") this.cb.elementsAt?.(p);
        break;
    }
    this.updateCursor();
    this.changed();
  }

  up(e: PointerEvent) {
    if (e.button !== 0 || !this.bitmap) return;
    switch (this.phase) {
      case "press": {
        // A click: take what's highlighted.
        const target = this.hover;
        this.phase = "idle";
        if (!target) break;
        if (this.mode === "window") return this.cb.commit(target, "done");
        if (this.mode === "text" || this.mode === "qr") return this.cb.commit(target, this.mode);
        this.sel = { ...target };
        this.phase = "selected";
        break;
      }
      case "draw":
        if (this.sel && this.sel.w >= 2 && this.sel.h >= 2) {
          if (this.mode === "text" || this.mode === "qr") return this.cb.commit(this.sel, this.mode);
          this.phase = "selected";
        } else {
          this.sel = null;
          this.phase = "idle";
          this.updateHover();
        }
        break;
      case "move":
      case "resize":
        this.phase = "selected";
        break;
      case "measure":
        this.phase = "idle";
        break;
    }
    this.updateCursor();
    this.changed();
  }

  doubleClick(e: MouseEvent) {
    if (this.phase === "selected" && this.sel && contains(this.sel, this.pt(e))) this.cb.commit(this.sel, "done");
  }

  /** Right click: drop the selection, or close if there is none. */
  rightClick() {
    if (this.phase === "selected" || this.ruler) this.reset();
    else this.cb.cancel();
  }

  wheel(e: WheelEvent) {
    if (this.phase !== "idle" || this.elements.length < 2) return;
    const next = this.level + (e.deltaY < 0 ? 1 : -1);
    this.level = Math.max(0, Math.min(this.elements.length - 1, next));
    this.updateHover();
    this.changed();
  }

  /** Returns true if the key was used. */
  key(e: KeyboardEvent): boolean {
    const k = e.key;
    const lower = k.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const target = this.target();

    if (k === "Escape") {
      if (this.phase === "selected" || this.ruler) this.reset();
      else this.cb.cancel();
      return true;
    }
    if (k === "Enter") {
      if (target) this.cb.commit(target, this.mode === "text" || this.mode === "qr" ? this.mode : "done");
      return true;
    }
    if (ctrl && (lower === "c" || lower === "s")) {
      if (target) this.cb.commit(target, lower === "c" ? "copy" : "save_as");
      return true;
    }

    if (k.startsWith("Arrow") && this.sel && this.phase === "selected") {
      const step = e.shiftKey ? 10 : 1;
      const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
      const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
      this.sel = ctrl ? grow(this.sel, dx, dy, this.bounds) : keepInside({ ...this.sel, x: this.sel.x + dx, y: this.sel.y + dy }, this.bounds);
      this.changed();
      return true;
    }
    if (ctrl || e.altKey) return false;

    const selected = this.phase === "selected" && this.sel;
    switch (lower) {
      case "e":
        if (target) this.cb.commit(target, "edit");
        return true;
      case "p":
        if (target) this.cb.commit(target, "pin");
        return true;
      case "t":
        if (selected) this.cb.commit(this.sel!, "text");
        else this.setMode("text");
        return true;
      case "q":
        if (selected) this.cb.commit(this.sel!, "qr");
        else this.setMode("qr");
        return true;
      case "c":
        this.cb.color(this.colorAt(this.cursor));
        return true;
      case "r":
        this.setMode("region");
        return true;
      case "w":
        this.setMode("window");
        return true;
      case "f":
        this.setMode("screen");
        return true;
      case "m":
        this.setMode("ruler");
        return true;
    }
    return false;
  }

  /** The selection, or in the idle state whatever is highlighted. */
  target(): Rect | null {
    if (this.phase === "selected" && this.sel) return this.sel;
    if (this.phase === "idle" && this.hover && this.mode !== "color" && this.mode !== "ruler") return this.hover;
    return null;
  }

  private reset() {
    this.sel = null;
    this.ruler = null;
    this.phase = "idle";
    this.updateHover();
    this.updateCursor();
    this.changed();
  }

  // ---- helpers ----

  private snapPoint(p: Pt): Pt {
    if (!this.snapOn || this.alt) return p;
    const th = 7 * this.ratio;
    const els = this.elements.map((e) => e.rect);
    const extra = edges(els);
    return { x: snap(p.x, [...this.lines.xs, ...extra.xs], th), y: snap(p.y, [...this.lines.ys, ...extra.ys], th) };
  }

  private snapMove(r: Rect): Rect {
    if (!this.snapOn || this.alt) return r;
    const th = 7 * this.ratio;
    const dx = bestShift([r.x, right(r)], this.lines.xs, th);
    const dy = bestShift([r.y, bottom(r)], this.lines.ys, th);
    return keepInside({ ...r, x: r.x + dx, y: r.y + dy }, this.bounds);
  }

  private topWindow(p: Pt): WindowInfo | undefined {
    return this.windows.find((w) => contains(w.rect, p));
  }

  private updateHover() {
    const p = this.cursor;
    let rect: Rect | null = null;
    let label = "";
    switch (this.mode) {
      case "screen":
        rect = this.bounds;
        break;
      case "fixed":
        rect = frameAt(p, this.fixed.w, this.fixed.h, this.bounds);
        break;
      case "color":
      case "ruler":
        break;
      default: {
        const el = this.mode === "window" ? undefined : this.elements[Math.min(this.level, this.elements.length - 1)];
        if (el && contains(el.rect, p)) {
          rect = el.rect;
          label = el.name;
        } else {
          const w = this.topWindow(p);
          rect = w ? intersect(w.rect, this.bounds) : this.bounds;
          label = w ? w.title || w.app : "";
        }
      }
    }
    this.hover = rect;
    this.hoverLabel = label;
  }

  private updateCursor() {
    let cursor = "crosshair";
    if (this.phase === "selected" && this.sel) {
      const h = handleAt(this.sel, this.cursor, 8 * this.ratio);
      if (h) cursor = CURSORS[h];
      else if (contains(this.sel, this.cursor)) cursor = "move";
    } else if (this.phase === "move") cursor = "move";
    else if (this.phase === "resize") cursor = CURSORS[this.handle];
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  colorAt(p: Pt): string {
    if (!this.pixels) return "#000000";
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(p.x)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(p.y)));
    const i = (y * this.width + x) * 4;
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(this.pixels[i])}${hex(this.pixels[i + 1])}${hex(this.pixels[i + 2])}`.toUpperCase();
  }

  private changed() {
    const view: View = {
      mode: this.mode,
      phase: this.phase,
      sel: this.sel,
      hover: this.hover,
      hoverLabel: this.hoverLabel,
      ratio: this.ratio,
      width: this.width,
      height: this.height,
    };
    const key = JSON.stringify(view);
    if (key !== this.lastView) {
      this.lastView = key;
      this.cb.change(view);
    }
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  // ---- drawing ----

  private draw() {
    this.frame = 0;
    const { ctx, width: W, height: H } = this;
    ctx.clearRect(0, 0, W, H);
    if (!this.bitmap) return;
    ctx.drawImage(this.bitmap, 0, 0);

    const selecting = this.phase === "draw" || this.phase === "selected" || this.phase === "move" || this.phase === "resize";
    const focus = selecting ? this.sel : this.phase === "idle" || this.phase === "press" ? this.hover : null;

    if (this.mode !== "color") {
      ctx.fillStyle = DIM;
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      if (focus) ctx.rect(focus.x, focus.y, focus.w, focus.h);
      ctx.fill("evenodd");
    }
    if (focus && this.mode !== "screen") this.drawFrame(focus, selecting);
    if (focus && this.mode === "screen") this.drawFrame(focus, true);
    if (this.ruler) this.drawRuler(this.ruler.a, this.ruler.b);

    const aiming = this.phase === "idle" || this.phase === "press" || this.phase === "draw" || this.phase === "resize";
    if (aiming && this.mode !== "screen" && this.mode !== "fixed") this.drawCrosshair();
    if ((this.magnifier && aiming && this.mode !== "screen") || this.mode === "color") this.drawMagnifier();
  }

  private drawFrame(r: Rect, strong: boolean) {
    const { ctx, ratio } = this;
    const lw = Math.max(1, Math.round(ratio));
    ctx.strokeStyle = TALLY;
    ctx.globalAlpha = strong ? 1 : 0.85;
    ctx.lineWidth = lw;
    ctx.strokeRect(r.x - lw / 2, r.y - lw / 2, r.w + lw, r.h + lw);
    ctx.globalAlpha = 1;
    if (!strong) return;

    // Viewfinder corners, drawn just outside the selection so they never
    // cover a captured pixel.
    const t = 3 * lw;
    const len = Math.max(t * 2, Math.min(18 * ratio, (r.w + 2 * t) / 2, (r.h + 2 * t) / 2));
    const x0 = r.x - t;
    const y0 = r.y - t;
    const x1 = right(r) + t;
    const y1 = bottom(r) + t;
    ctx.fillStyle = TALLY;
    ctx.fillRect(x0, y0, len, t);
    ctx.fillRect(x0, y0, t, len);
    ctx.fillRect(x1 - len, y0, len, t);
    ctx.fillRect(x1 - t, y0, t, len);
    ctx.fillRect(x0, y1 - t, len, t);
    ctx.fillRect(x0, y1 - len, t, len);
    ctx.fillRect(x1 - len, y1 - t, len, t);
    ctx.fillRect(x1 - t, y1 - len, t, len);

    if (this.phase === "selected" && r.w > 60 * ratio && r.h > 60 * ratio) {
      // Edge grips at the middle of each side.
      const g = 12 * ratio;
      const mx = r.x + r.w / 2;
      const my = r.y + r.h / 2;
      ctx.fillRect(mx - g / 2, y0, g, t);
      ctx.fillRect(mx - g / 2, y1 - t, g, t);
      ctx.fillRect(x0, my - g / 2, t, g);
      ctx.fillRect(x1 - t, my - g / 2, t, g);
    }
  }

  private drawCrosshair() {
    const { ctx, ratio, cursor } = this;
    if (cursor.x < 0) return;
    const lw = Math.max(1, Math.round(ratio));
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.fillRect(0, Math.floor(cursor.y), this.width, lw);
    ctx.fillRect(Math.floor(cursor.x), 0, lw, this.height);
  }

  private drawMagnifier() {
    const { ctx, ratio, cursor } = this;
    if (!this.bitmap || cursor.x < 0) return;
    const n = 15;
    const half = 7;
    const cell = Math.round(8 * ratio);
    const size = n * cell;
    const info = Math.round(46 * ratio);
    const gap = 26 * ratio;
    const cx = Math.floor(cursor.x);
    const cy = Math.floor(cursor.y);
    let mx = cx + gap;
    let my = cy + gap;
    if (mx + size > this.width) mx = cx - gap - size;
    if (my + size + info > this.height) my = cy - gap - size - info;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 16 * ratio;
    ctx.fillStyle = "#0e1013";
    ctx.fillRect(mx, my, size, size + info);
    ctx.shadowBlur = 0;

    // Copy only the part of the 15×15 area that is on screen.
    const sx0 = Math.max(0, cx - half);
    const sy0 = Math.max(0, cy - half);
    const sx1 = Math.min(this.width, cx + half + 1);
    const sy1 = Math.min(this.height, cy + half + 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.bitmap,
      sx0,
      sy0,
      sx1 - sx0,
      sy1 - sy0,
      mx + (sx0 - (cx - half)) * cell,
      my + (sy0 - (cy - half)) * cell,
      (sx1 - sx0) * cell,
      (sy1 - sy0) * cell,
    );

    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    for (let i = 1; i < n; i++) {
      ctx.fillRect(mx + i * cell, my, 1, size);
      ctx.fillRect(mx, my + i * cell, size, 1);
    }
    const lw = Math.max(1, Math.round(ratio));
    ctx.strokeStyle = TALLY;
    ctx.lineWidth = lw;
    ctx.strokeRect(mx + half * cell + lw / 2, my + half * cell + lw / 2, cell - lw, cell - lw);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.strokeRect(mx + 0.5, my + 0.5, size - 1, size + info - 1);

    // Two lines: colour (with a swatch) on top, position below.
    const hex = this.colorAt(cursor);
    const sw = Math.round(12 * ratio);
    const pad = 10 * ratio;
    const line1 = my + size + info * 0.33;
    const line2 = my + size + info * 0.72;
    ctx.fillStyle = hex;
    ctx.fillRect(mx + pad, line1 - sw / 2, sw, sw);
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(12.5 * ratio)}px Bahnschrift, "Segoe UI", sans-serif`;
    ctx.fillStyle = "#f2f4f6";
    ctx.fillText(hex, mx + pad + sw + 7 * ratio, line1);
    ctx.font = `${Math.round(11.5 * ratio)}px Bahnschrift, "Segoe UI", sans-serif`;
    ctx.fillStyle = "#9aa2ae";
    ctx.fillText(`X ${cx}   Y ${cy}`, mx + pad, line2);
    ctx.restore();
  }

  private drawRuler(a: Pt, b: Pt) {
    const { ctx, ratio } = this;
    const lw = Math.max(1, Math.round(ratio));
    const dx = Math.round(b.x - a.x);
    const dy = Math.round(b.y - a.y);
    ctx.save();
    ctx.strokeStyle = TALLY;
    ctx.lineWidth = lw * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Dashed box showing the horizontal and vertical extents.
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(255, 180, 0, 0.6)";
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(dx), Math.abs(dy));
    ctx.setLineDash([]);
    ctx.fillStyle = TALLY;
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * ratio, 0, Math.PI * 2);
      ctx.fill();
    }
    const label = `${Math.abs(dx)} × ${Math.abs(dy)}  ·  ${Math.round(Math.hypot(dx, dy))} px`;
    ctx.font = `600 ${Math.round(13 * ratio)}px Bahnschrift, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(label).width + 16 * ratio;
    const th = 26 * ratio;
    const lx = Math.min(Math.max((a.x + b.x) / 2 - tw / 2, 4), this.width - tw - 4);
    const ly = Math.min(Math.max((a.y + b.y) / 2 - th - 10 * ratio, 4), this.height - th - 4);
    ctx.fillStyle = "rgba(14, 16, 19, 0.92)";
    ctx.fillRect(lx, ly, tw, th);
    ctx.fillStyle = "#f2f4f6";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 8 * ratio, ly + th / 2);
    ctx.restore();
  }
}

/** The smallest shift (within th) that puts one of `values` on a line. */
function bestShift(values: number[], lines: number[], th: number): number {
  let best = 0;
  let dist = th + 1;
  for (const v of values) {
    for (const l of lines) {
      const d = l - v;
      if (Math.abs(d) <= th && Math.abs(d) < dist) {
        best = d;
        dist = Math.abs(d);
      }
    }
  }
  return best;
}

/** Corner-drag with Shift: keep the starting aspect ratio. */
function keepRatio(r: Rect, start: Rect, handle: Handle): Rect {
  const ratio = start.w / Math.max(1, start.h);
  let { w, h } = r;
  if (w / Math.max(1, h) > ratio) w = Math.round(h * ratio);
  else h = Math.round(w / ratio);
  const x = handle.includes("w") ? right(start) - w : start.x;
  const y = handle.includes("n") ? bottom(start) - h : start.y;
  return { x, y, w, h };
}

// The editor's canvas: draws the image with its marks and tool previews,
// handles zoom and pan, and turns pointer input into ops and marks.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
} from "react";
import type { Rect } from "../shared/api";
import { contains, fromPoints, handleAt, intersect, keepInside, resize, type Handle, type Pt } from "../shared/geometry";
import { markAt, markId, nextStep, shiftMark, type Axis, type Doc, type HideStyle, type Mark, type Op } from "./doc";
import { drawMark, drawMarks, markBounds, MARK_FONT } from "./render";

export type Tool = "select" | "crop" | "erase" | "fill" | "cut" | "hide" | "arrow" | "box" | "highlight" | "text" | "step";

export type Options = {
  color: string;
  highlight: string;
  width: number;
  hide: HideStyle;
  strength: number;
  eraseMode: "box" | "brush";
  brush: number;
  axis: Axis;
  textSize: number;
  stepSize: number;
};

/** zoom: CSS px per image px; x, y: where the image's top-left sits (CSS px). */
export type View = { zoom: number; x: number; y: number };

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "rect"; tool: Tool; start: Pt; now: Pt }
  | { kind: "line"; start: Pt; now: Pt }
  | { kind: "stroke"; points: Pt[] }
  | { kind: "band"; start: Pt; now: Pt }
  | { kind: "move"; id: string; start: Pt; now: Pt }
  | { kind: "crop"; mode: Handle | "move" | "new"; start: Pt; orig: Rect };

type TextEdit = { at: Pt; value: string; id?: string };

type Props = {
  base: OffscreenCanvas | null;
  version: number;
  doc: Doc;
  tool: Tool;
  opts: Options;
  view: View;
  onView: (v: View) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  crop: Rect | null;
  onCrop: (r: Rect) => void;
  cropRatio: number | null;
  onOp: (op: Op) => void;
  onFill: (r: Rect) => void;
  onMarks: (marks: Mark[], select?: string) => void;
  onCursor: (p: Pt | null) => void;
  onStageSize: (w: number, h: number) => void;
};

const TALLY = "#ffb400";

export function Stage(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const cursor = useRef<Pt | null>(null);
  const space = useRef(false);
  const frame = useRef(0);
  const [text, setText] = useState<TextEdit | null>(null);
  const [cursorStyle, setCursorStyle] = useState("default");
  const props = useRef(p);
  props.current = p;

  const toImage = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { zoom, x, y } = props.current.view;
    return { x: (e.clientX - rect.left - x) / zoom, y: (e.clientY - rect.top - y) / zoom };
  }, []);

  const bounds = (): Rect => ({ x: 0, y: 0, w: props.current.doc.width, h: props.current.doc.height });
  const clampRect = (r: Rect): Rect | null => {
    const rounded = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    return intersect(rounded, bounds());
  };

  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas size follows the stage.
  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const c = canvasRef.current!;
      const dpr = devicePixelRatio || 1;
      c.width = Math.round(wrap.clientWidth * dpr);
      c.height = Math.round(wrap.clientHeight * dpr);
      props.current.onStageSize(wrap.clientWidth, wrap.clientHeight);
      requestDraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestDraw]);

  useEffect(requestDraw, [p.version, p.doc, p.tool, p.view, p.selected, p.crop, p.opts, text, requestDraw]);

  // Space held = pan with the mouse.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).matches("input, textarea")) {
        space.current = true;
        setCursorStyle("grab");
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        setCursorStyle(baseCursor(props.current.tool));
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    setCursorStyle(baseCursor(p.tool));
    setText(null);
  }, [p.tool]);

  // ---- drawing ----

  function draw() {
    frame.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = devicePixelRatio || 1;
    const { doc, base, view, tool, crop, selected, opts } = props.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Checkerboard where the image is, so transparency shows.
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.fillStyle = checker(ctx);
    ctx.fillRect(0, 0, doc.width * view.zoom, doc.height * view.zoom);
    ctx.restore();

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.imageSmoothingEnabled = view.zoom * dpr < 1; // pixel-exact when zoomed in
    ctx.imageSmoothingQuality = "high";
    if (base) ctx.drawImage(base, 0, 0);

    const d = drag.current;
    const marks = d?.kind === "move" ? doc.marks.map((m) => (m.id === d.id ? shiftMark(m, d.now.x - d.start.x, d.now.y - d.start.y) : m)) : doc.marks;
    drawMarks(ctx, marks, text?.id);
    if (d) drawPreview(ctx, d, opts, doc);
    ctx.restore();

    // Screen-space overlays.
    if (tool === "crop" && crop) drawCrop(ctx, crop, view, c.width / dpr, c.height / dpr);
    if (selected && tool === "select") {
      const m = marks.find((x) => x.id === selected);
      if (m) {
        const b = markBounds(m, ctx);
        ctx.save();
        ctx.strokeStyle = TALLY;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(view.x + b.x * view.zoom - 5, view.y + b.y * view.zoom - 5, b.w * view.zoom + 10, b.h * view.zoom + 10);
        ctx.restore();
      }
    }
    const cur = cursor.current;
    if (cur && tool === "erase" && opts.eraseMode === "brush" && !space.current) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(view.x + cur.x * view.zoom, view.y + cur.y * view.zoom, (opts.brush / 2) * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(view.x + cur.x * view.zoom, view.y + cur.y * view.zoom, (opts.brush / 2) * view.zoom + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- input ----

  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (text) commitText();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const pt = toImage(e);
    const { tool, doc, view, opts, crop } = props.current;
    if (e.button === 1 || space.current) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      setCursorStyle("grabbing");
      return;
    }
    if (e.button !== 0) return;
    const slack = 6 / view.zoom;
    switch (tool) {
      case "select": {
        const m = markAt(doc.marks, pt, slack);
        props.current.onSelect(m?.id ?? null);
        drag.current = m ? { kind: "move", id: m.id, start: pt, now: pt } : { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        if (!m) setCursorStyle("grabbing");
        break;
      }
      case "crop": {
        const r = crop ?? bounds();
        const h = handleAt(r, pt, 9 / view.zoom);
        drag.current = { kind: "crop", mode: h ?? (contains(r, pt) ? "move" : "new"), start: pt, orig: r };
        break;
      }
      case "erase":
        drag.current = opts.eraseMode === "brush" ? { kind: "stroke", points: [pt] } : { kind: "rect", tool, start: pt, now: pt };
        break;
      case "fill":
      case "hide":
      case "box":
      case "highlight":
        drag.current = { kind: "rect", tool, start: pt, now: pt };
        break;
      case "arrow":
        drag.current = { kind: "line", start: pt, now: pt };
        break;
      case "cut":
        drag.current = { kind: "band", start: pt, now: pt };
        break;
      case "text":
        setText({ at: pt, value: "" });
        break;
      case "step": {
        const id = markId();
        props.current.onMarks([...doc.marks, { id, kind: "step", at: pt, n: nextStep(doc.marks), color: opts.color, size: opts.stepSize }]);
        break;
      }
    }
    requestDraw();
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    const pt = toImage(e);
    cursor.current = pt;
    const { doc, view } = props.current;
    const inside = pt.x >= 0 && pt.y >= 0 && pt.x < doc.width && pt.y < doc.height;
    props.current.onCursor(inside ? { x: Math.floor(pt.x), y: Math.floor(pt.y) } : null);
    const d = drag.current;
    if (!d) {
      hoverCursor(pt);
      if (props.current.tool === "erase") requestDraw();
      return;
    }
    switch (d.kind) {
      case "pan":
        props.current.onView({ ...view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
        break;
      case "rect":
      case "line":
      case "band":
      case "move":
        d.now = pt;
        break;
      case "stroke":
        d.points.push(pt);
        break;
      case "crop":
        props.current.onCrop(cropFrom(d, pt, e.shiftKey));
        break;
    }
    requestDraw();
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    const { tool, doc, opts } = props.current;
    if (!d) return;
    switch (d.kind) {
      case "pan":
        setCursorStyle(space.current ? "grab" : baseCursor(tool));
        break;
      case "rect": {
        const r = clampRect(fromPoints(d.start, d.now));
        if (!r || r.w < 2 || r.h < 2) break;
        if (d.tool === "erase") props.current.onOp({ kind: "erase", rect: r });
        if (d.tool === "fill") props.current.onFill(r);
        if (d.tool === "hide") props.current.onOp({ kind: "hide", rect: r, style: opts.hide, strength: opts.strength });
        if (d.tool === "box") {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: "box", rect: r, color: opts.color, width: opts.width }], id);
        }
        if (d.tool === "highlight") props.current.onMarks([...doc.marks, { id: markId(), kind: "highlight", rect: r, color: opts.highlight }]);
        break;
      }
      case "line":
        if (Math.hypot(d.now.x - d.start.x, d.now.y - d.start.y) > 4) {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: "arrow", a: d.start, b: d.now, color: opts.color, width: opts.width }], id);
        }
        break;
      case "stroke":
        props.current.onOp({ kind: "eraseStroke", points: d.points, size: opts.brush });
        break;
      case "band": {
        const horizontal = opts.axis === "horizontal";
        const limit = horizontal ? doc.height : doc.width;
        const a = Math.round(Math.max(0, Math.min(horizontal ? d.start.y : d.start.x, horizontal ? d.now.y : d.now.x)));
        const b = Math.round(Math.min(limit, Math.max(horizontal ? d.start.y : d.start.x, horizontal ? d.now.y : d.now.x)));
        if (b - a >= 1 && b - a < limit) props.current.onOp({ kind: "cut", axis: opts.axis, from: a, to: b });
        break;
      }
      case "move": {
        const dx = d.now.x - d.start.x;
        const dy = d.now.y - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) props.current.onMarks(doc.marks.map((m) => (m.id === d.id ? shiftMark(m, dx, dy) : m)), d.id);
        break;
      }
      case "crop":
        break;
    }
    requestDraw();
  }

  function onWheel(e: RWheelEvent) {
    const { view } = props.current;
    if (e.ctrlKey) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const zoom = Math.min(32, Math.max(0.05, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      props.current.onView({ zoom, x: cx - ((cx - view.x) * zoom) / view.zoom, y: cy - ((cy - view.y) * zoom) / view.zoom });
    } else if (e.shiftKey) {
      props.current.onView({ ...view, x: view.x - e.deltaY });
    } else {
      props.current.onView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
    }
  }

  function onDoubleClick(e: RMouseEvent) {
    const { tool, doc, view } = props.current;
    if (tool !== "select" && tool !== "text") return;
    const m = markAt(doc.marks, toImage(e), 6 / view.zoom);
    if (m?.kind === "text") setText({ at: m.at, value: m.text, id: m.id });
  }

  function hoverCursor(pt: Pt) {
    const { tool, doc, view, crop } = props.current;
    if (space.current) return;
    let style = baseCursor(tool);
    if (tool === "select") style = markAt(doc.marks, pt, 6 / view.zoom) ? "move" : "default";
    if (tool === "crop" && crop) {
      const h = handleAt(crop, pt, 9 / view.zoom);
      style = h ? HANDLE_CURSOR[h] : contains(crop, pt) ? "move" : "crosshair";
    }
    if (style !== cursorStyle) setCursorStyle(style);
  }

  function cropFrom(d: Extract<Drag, { kind: "crop" }>, pt: Pt, shift: boolean): Rect {
    const all = bounds();
    const ratio = props.current.cropRatio ?? (shift ? d.orig.w / Math.max(1, d.orig.h) : null);
    let r: Rect;
    if (d.mode === "move") {
      r = keepInside({ ...d.orig, x: Math.round(d.orig.x + pt.x - d.start.x), y: Math.round(d.orig.y + pt.y - d.start.y) }, all);
      return r;
    }
    r = d.mode === "new" ? fromPoints(d.start, pt) : resize(d.orig, d.mode, pt);
    if (ratio) {
      // The dragged side decides; the other side follows the ratio.
      if (d.mode === "n" || d.mode === "s") r = { ...r, w: Math.max(1, Math.round(r.h * ratio)) };
      else r = { ...r, h: Math.max(1, Math.round(r.w / ratio)) };
      // Keep the corner opposite the pointer where it was.
      if (d.mode === "new") {
        if (pt.y < d.start.y) r = { ...r, y: Math.round(d.start.y - r.h) };
        if (pt.x < d.start.x) r = { ...r, x: Math.round(d.start.x - r.w) };
      } else {
        if (d.mode.includes("n")) r = { ...r, y: d.orig.y + d.orig.h - r.h };
        if (d.mode.includes("w")) r = { ...r, x: d.orig.x + d.orig.w - r.w };
      }
    }
    return intersect(r, all) ?? d.orig;
  }

  function commitText() {
    const t = text;
    setText(null);
    if (!t) return;
    const { doc, opts } = props.current;
    const value = t.value.replace(/\s+$/, "");
    if (t.id) {
      const marks = value
        ? doc.marks.map((m) => (m.id === t.id && m.kind === "text" ? { ...m, text: value } : m))
        : doc.marks.filter((m) => m.id !== t.id);
      props.current.onMarks(marks, t.id);
    } else if (value) {
      const id = markId();
      props.current.onMarks([...doc.marks, { id, kind: "text", at: t.at, text: value, color: opts.color, size: opts.textSize }], id);
    }
  }

  const textMark = text?.id ? (p.doc.marks.find((m) => m.id === text.id) as Extract<Mark, { kind: "text" }> | undefined) : undefined;
  const textSize = (textMark?.size ?? p.opts.textSize) * p.view.zoom;

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          cursor.current = null;
          props.current.onCursor(null);
          requestDraw();
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {text && (
        <textarea
          className="stage-text"
          autoFocus
          spellCheck={false}
          value={text.value}
          style={{
            left: p.view.x + text.at.x * p.view.zoom,
            top: p.view.y + text.at.y * p.view.zoom,
            fontSize: textSize,
            lineHeight: 1.25,
            color: textMark?.color ?? p.opts.color,
            fontFamily: MARK_FONT,
            minWidth: textSize * 4,
          }}
          rows={Math.max(1, text.value.split("\n").length)}
          onChange={(e) => setText({ ...text, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setText(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
          }}
          onBlur={commitText}
        />
      )}
    </div>
  );
}

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

function baseCursor(tool: Tool): string {
  if (tool === "select") return "default";
  if (tool === "text") return "text";
  if (tool === "erase") return "crosshair";
  return "crosshair";
}

let pattern: { theme: string; value: CanvasPattern } | null = null;

function checker(ctx: CanvasRenderingContext2D): CanvasPattern {
  const theme = document.documentElement.dataset.theme ?? "light";
  if (pattern?.theme === theme) return pattern.value;
  const tile = new OffscreenCanvas(16, 16);
  const t = tile.getContext("2d")!;
  const [a, b] = theme === "dark" ? ["#23272d", "#1a1d22"] : ["#ffffff", "#e7eaee"];
  t.fillStyle = a;
  t.fillRect(0, 0, 16, 16);
  t.fillStyle = b;
  t.fillRect(0, 0, 8, 8);
  t.fillRect(8, 8, 8, 8);
  pattern = { theme, value: ctx.createPattern(tile, "repeat")! };
  return pattern.value;
}

/** Live previews while dragging, in image coordinates. */
function drawPreview(ctx: CanvasRenderingContext2D, d: Drag, opts: Options, doc: Doc) {
  const tint = (r: Rect, fill: string, stroke: string) => {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5 / ctx.getTransform().a;
    ctx.setLineDash([6 / ctx.getTransform().a, 4 / ctx.getTransform().a]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  };
  if (d.kind === "rect") {
    const r = fromPoints(d.start, d.now);
    if (d.tool === "box") drawMark(ctx, { id: "p", kind: "box", rect: r, color: opts.color, width: opts.width });
    else if (d.tool === "highlight") drawMark(ctx, { id: "p", kind: "highlight", rect: r, color: opts.highlight });
    else if (d.tool === "erase") tint(r, "rgba(229, 72, 77, 0.22)", "#e5484d");
    else tint(r, "rgba(255, 180, 0, 0.18)", TALLY);
  }
  if (d.kind === "line") drawMark(ctx, { id: "p", kind: "arrow", a: d.start, b: d.now, color: opts.color, width: opts.width });
  if (d.kind === "stroke") {
    ctx.save();
    ctx.strokeStyle = "rgba(229, 72, 77, 0.55)";
    ctx.lineWidth = opts.brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    d.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }
  if (d.kind === "band") {
    const horizontal = opts.axis === "horizontal";
    const a = Math.min(horizontal ? d.start.y : d.start.x, horizontal ? d.now.y : d.now.x);
    const b = Math.max(horizontal ? d.start.y : d.start.x, horizontal ? d.now.y : d.now.x);
    const r = horizontal ? { x: 0, y: a, w: doc.width, h: b - a } : { x: a, y: 0, w: b - a, h: doc.height };
    tint(r, "rgba(229, 72, 77, 0.28)", "#e5484d");
  }
}

/** The crop frame: everything outside dimmed, thirds, viewfinder corners. */
function drawCrop(ctx: CanvasRenderingContext2D, r: Rect, view: View, w: number, h: number) {
  const x = view.x + r.x * view.zoom;
  const y = view.y + r.y * view.zoom;
  const cw = r.w * view.zoom;
  const ch = r.h * view.zoom;
  ctx.save();
  ctx.fillStyle = "rgba(8, 10, 14, 0.55)";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(x, y, cw, ch);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (cw * i) / 3, y);
    ctx.lineTo(x + (cw * i) / 3, y + ch);
    ctx.moveTo(x, y + (ch * i) / 3);
    ctx.lineTo(x + cw, y + (ch * i) / 3);
    ctx.stroke();
  }
  ctx.strokeStyle = TALLY;
  ctx.strokeRect(x - 0.5, y - 0.5, cw + 1, ch + 1);
  ctx.fillStyle = TALLY;
  const t = 3;
  const len = Math.min(18, cw / 2, ch / 2);
  const corners: [number, number, number, number][] = [
    [x - t, y - t, 1, 1],
    [x + cw + t, y - t, -1, 1],
    [x - t, y + ch + t, 1, -1],
    [x + cw + t, y + ch + t, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.fillRect(sx > 0 ? cx : cx - len, sy > 0 ? cy : cy - t, len, t);
    ctx.fillRect(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - len, t, len);
  }
  ctx.restore();
}

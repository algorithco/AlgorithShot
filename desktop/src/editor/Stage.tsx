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
import { flushSync } from "react-dom";
import type { Rect } from "../shared/api";
import { useT } from "../shared/i18n";
import { contains, fromPoints, handleAt, intersect, type Handle, type Pt } from "../shared/geometry";
import { dragCrop } from "./crop";
import { handleOfMark, markAt, markHandles, markId, nextStep, reshapeMark, shiftMark, type Axis, type Doc, type HideStyle, type Mark, type Op } from "./doc";
import { drawMark, drawMarks, flatten, markBounds, MARK_FONT } from "./render";

export type Tool = "select" | "crop" | "erase" | "fill" | "cut" | "hide" | "pen" | "pencil" | "marker" | "line" | "ellipse" | "eyedropper" | "arrow" | "box" | "highlight" | "text" | "step";

export type Options = {
  color: string;
  highlight: string;
  width: number;
  opacity: number;
  fillShape: boolean;
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
  | { kind: "line"; tool: "arrow" | "line"; start: Pt; now: Pt }
  | { kind: "stroke"; tool: "erase" | "pen" | "pencil" | "marker"; points: Pt[] }
  | { kind: "band"; start: Pt; now: Pt }
  | { kind: "move"; id: string; start: Pt; now: Pt }
  | { kind: "reshape"; id: string; handle: string; orig: Mark; start: Pt; now: Pt }
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
  onPickColor: (color: string) => void;
  disabled?: boolean;
};

const TALLY = "#ffd300";

// Drawing tools always draw, including over existing marks.
const EDITS_MARKS = new Set<Tool>(["select"]);
const BRUSH_TOOLS = new Set<Tool>(["pen", "pencil", "marker"]);

export function Stage(p: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointerId = useRef<number | null>(null);
  const gestureOpts = useRef(p.opts);
  const cursor = useRef<Pt | null>(null);
  const space = useRef(false);
  const frame = useRef(0);
  const [text, showText] = useState<TextEdit | null>(null);
  // The text being typed, read by commitText: a blur and a click can both
  // commit, and only the first one should.
  const liveText = useRef<TextEdit | null>(null);
  const setText = (t: TextEdit | null) => {
    liveText.current = t;
    showText(t);
  };
  const textRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const preventPageZoom = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener("wheel", preventPageZoom, { passive: false });
    return () => canvas.removeEventListener("wheel", preventPageZoom);
  }, []);

  // Undo, redo, or another document change must not leave a held gesture alive.
  useEffect(() => { if (drag.current) cancelDrag(); }, [p.doc]);

  // Space held = pan with the mouse.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        cancelDrag();
        e.preventDefault();
      }
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
    const blur = () => { space.current = false; cancelDrag(); };
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  useEffect(() => {
    cancelDrag();
    setCursorStyle(baseCursor(p.tool));
    setText(null);
  }, [p.tool]);

  useEffect(() => { if (p.disabled) cancelDrag(); }, [p.disabled]);

  const textOpen = !!text;
  useEffect(() => {
    if (!textOpen) return;
    const el = textRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [textOpen, text?.id]);

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
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = view.zoom * dpr < 1; // pixel-exact when zoomed in
    ctx.imageSmoothingQuality = "high";
    if (base) ctx.drawImage(base, 0, 0);

    const d = drag.current;
    const marks =
      d?.kind === "move"
        ? doc.marks.map((m) => (m.id === d.id ? shiftMark(m, d.now.x - d.start.x, d.now.y - d.start.y) : m))
        : d?.kind === "reshape"
          ? doc.marks.map((m) => (m.id === d.id ? reshapeMark(d.orig, d.handle, d.now) : m))
          : doc.marks;
    drawMarks(ctx, marks, liveText.current?.id);
    if (d) drawPreview(ctx, d, gestureOpts.current, doc);
    ctx.restore();

    // Screen-space overlays.
    if (tool === "crop" && crop) drawCrop(ctx, crop, view, c.width / dpr, c.height / dpr);
    // The selected mark: a dashed outline, and handles to resize it.
    const sel = selected && EDITS_MARKS.has(tool) ? marks.find((x) => x.id === selected) : undefined;
    if (sel && sel.id !== liveText.current?.id) {
      const handles = markHandles(sel);
      ctx.save();
      if (sel.kind !== "arrow" && sel.kind !== "line") {
        const b = markBounds(sel, ctx);
        const pad = handles.length ? 0 : 5;
        ctx.strokeStyle = TALLY;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(view.x + b.x * view.zoom - pad, view.y + b.y * view.zoom - pad, b.w * view.zoom + pad * 2, b.h * view.zoom + pad * 2);
        ctx.setLineDash([]);
      }
      for (const h of handles) {
        const hx = view.x + h.at.x * view.zoom;
        const hy = view.y + h.at.y * view.zoom;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = TALLY;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (sel.kind === "arrow" || sel.kind === "line") ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        else ctx.rect(hx - 5, hy - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    const cur = cursor.current;
    const inside = cur && contains({ x: 0, y: 0, w: doc.width, h: doc.height }, cur);
    props.current.onCursor(inside ? { x: Math.floor(cur.x), y: Math.floor(cur.y) } : null);
    if (inside && ((tool === "erase" && opts.eraseMode === "brush") || BRUSH_TOOLS.has(tool)) && !space.current) {
      const diameter = tool === "erase" ? opts.brush : opts.width;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(view.x + cur.x * view.zoom, view.y + cur.y * view.zoom, Math.max(1, (diameter / 2) * view.zoom), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(view.x + cur.x * view.zoom, view.y + cur.y * view.zoom, Math.max(1, (diameter / 2) * view.zoom) + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- input ----

  function releasePointer() {
    const id = pointerId.current;
    pointerId.current = null;
    if (id !== null && canvasRef.current?.hasPointerCapture(id)) canvasRef.current.releasePointerCapture(id);
  }

  function cancelDrag() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "crop") props.current.onCrop(d.orig);
    releasePointer();
    setCursorStyle(baseCursor(props.current.tool));
    requestDraw();
  }

  function onPointerDown(e: RPointerEvent<HTMLCanvasElement>) {
    if (props.current.disabled || pointerId.current !== null || !e.isPrimary || (e.button !== 0 && e.button !== 1)) return;
    // Pointer input is handled here, including focus and text commits.
    e.preventDefault();
    if (text) { commitText(); return; }
    // Commit numeric/HEX drafts before taking the brush settings snapshot.
    flushSync(() => canvasRef.current!.focus({ preventScroll: true }));
    pointerId.current = e.pointerId;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const pt = toImage(e);
    const { tool, doc, view, opts, crop, selected } = props.current;
    gestureOpts.current = { ...opts };
    if (e.button === 1 || space.current) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      setCursorStyle("grabbing");
      return;
    }
    if (e.button !== 0) return;
    if (!contains(bounds(), pt) && tool !== "crop" && tool !== "select") { releasePointer(); return; }
    if (tool === "eyedropper") {
      const base = props.current.base;
      if (base) {
        const [r, g, b, a] = flatten(base, doc.marks).getContext("2d")!.getImageData(Math.floor(pt.x), Math.floor(pt.y), 1, 1).data;
        if (a) props.current.onPickColor(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
      }
      releasePointer();
      return;
    }
    const slack = 6 / view.zoom;
    if (EDITS_MARKS.has(tool)) {
      const current = doc.marks.find((m) => m.id === selected);
      const handle = current && handleOfMark(current, pt, 9 / view.zoom);
      if (current && handle) {
        drag.current = { kind: "reshape", id: current.id, handle, orig: current, start: pt, now: pt };
        return;
      }
      const hit = markAt(doc.marks, pt, slack);
      if (hit) {
        props.current.onSelect(hit.id);
        if (tool === "text" && hit.kind === "text") setText({ at: hit.at, value: hit.text, id: hit.id });
        else drag.current = { kind: "move", id: hit.id, start: pt, now: pt };
        requestDraw();
        return;
      }
      props.current.onSelect(null);
    }
    switch (tool) {
      case "select":
        // Nothing under the pointer: drag pans the picture.
        drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        setCursorStyle("grabbing");
        break;
      case "crop": {
        const r = crop ?? bounds();
        const h = handleAt(r, pt, 9 / view.zoom);
        const full = r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height;
        drag.current = { kind: "crop", mode: h ?? (!full && contains(r, pt) ? "move" : "new"), start: pt, orig: r };
        break;
      }
      case "erase":
        drag.current = opts.eraseMode === "brush" ? { kind: "stroke", tool, points: [pt] } : { kind: "rect", tool, start: pt, now: pt };
        break;
      case "pen":
      case "pencil":
      case "marker":
        props.current.onSelect(null);
        drag.current = { kind: "stroke", tool, points: [pt] };
        break;
      case "fill":
      case "hide":
      case "box":
      case "ellipse":
      case "highlight":
        drag.current = { kind: "rect", tool, start: pt, now: pt };
        break;
      case "arrow":
      case "line":
        drag.current = { kind: "line", tool, start: pt, now: pt };
        break;
      case "cut":
        drag.current = { kind: "band", start: pt, now: pt };
        break;
      case "text":
        setText({ at: pt, value: "" });
        break;
      case "step": {
        const id = markId();
        props.current.onMarks([...doc.marks, { id, kind: "step", at: pt, n: nextStep(doc.marks), color: opts.color, size: opts.stepSize }], id);
        break;
      }
    }
    requestDraw();
  }

  function onPointerMove(e: RPointerEvent<HTMLCanvasElement>) {
    if (pointerId.current !== null && pointerId.current !== e.pointerId) return;
    const pt = toImage(e);
    cursor.current = pt;
    const { view } = props.current;
    const d = drag.current;
    if (!d) {
      hoverCursor(pt);
      requestDraw();
      return;
    }
    switch (d.kind) {
      case "pan":
        props.current.onView({ ...view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
        break;
      case "rect":
        d.now = e.shiftKey && (d.tool === "box" || d.tool === "ellipse") ? squareEnd(d.start, pt) : pt;
        break;
      case "line":
        d.now = e.shiftKey ? snapLine(d.start, pt) : pt;
        break;
      case "band":
      case "move":
      case "reshape":
        d.now = pt;
        break;
      case "stroke":
        for (const event of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
          const next = toImage(event);
          const last = d.points[d.points.length - 1];
          if (Math.hypot(next.x - last.x, next.y - last.y) >= 0.25) d.points.push(next);
        }
        // Some engines return an empty coalesced-event list on pointerup.
        const last = d.points[d.points.length - 1];
        if (last.x !== pt.x || last.y !== pt.y) d.points.push(pt);
        break;
      case "crop":
        props.current.onCrop(cropFrom(d, pt, e.shiftKey));
        break;
    }
    requestDraw();
  }

  function onPointerUp(e: RPointerEvent<HTMLCanvasElement>) {
    if (pointerId.current !== e.pointerId) return;
    // The release position is part of the gesture even when no move arrived.
    onPointerMove(e);
    const d = drag.current;
    drag.current = null;
    releasePointer();
    const { tool, doc } = props.current;
    const opts = gestureOpts.current;
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
        if (d.tool === "box" || d.tool === "ellipse") {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: d.tool, rect: r, color: opts.color, width: opts.width, opacity: opts.opacity, fill: opts.fillShape }], id);
        }
        if (d.tool === "highlight") {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: "highlight", rect: r, color: opts.highlight, opacity: opts.opacity }], id);
        }
        break;
      }
      case "line":
        if (Math.hypot(d.now.x - d.start.x, d.now.y - d.start.y) > (d.tool === "arrow" ? 4 : 0.5)) {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: d.tool, a: d.start, b: d.now, color: opts.color, width: opts.width, opacity: opts.opacity }], id);
        }
        break;
      case "stroke":
        if (d.tool === "erase") props.current.onOp({ kind: "eraseStroke", points: d.points.slice(), size: opts.brush });
        else {
          const id = markId();
          props.current.onMarks([...doc.marks, { id, kind: "stroke", tool: d.tool, points: d.points.slice(), color: d.tool === "marker" ? opts.highlight : opts.color, width: opts.width, opacity: opts.opacity }]);
        }
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
      case "reshape": {
        if (Math.abs(d.now.x - d.start.x) + Math.abs(d.now.y - d.start.y) > 0.5) props.current.onMarks(doc.marks.map((m) => (m.id === d.id ? reshapeMark(d.orig, d.handle, d.now) : m)), d.id);
        break;
      }
      case "crop":
        break;
    }
    requestDraw();
  }

  function onWheel(e: RWheelEvent) {
    if (drag.current || props.current.disabled) return;
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
    if (props.current.disabled) return;
    const { tool, doc, view } = props.current;
    if (tool !== "select" && tool !== "text") return;
    const m = markAt(doc.marks, toImage(e), 6 / view.zoom);
    if (m?.kind === "text") setText({ at: m.at, value: m.text, id: m.id });
  }

  function hoverCursor(pt: Pt) {
    const { tool, doc, view, crop } = props.current;
    if (space.current) return;
    let style = baseCursor(tool);
    if (EDITS_MARKS.has(tool)) {
      const current = doc.marks.find((m) => m.id === props.current.selected);
      const handle = current && handleOfMark(current, pt, 9 / view.zoom);
      const hit = !handle && markAt(doc.marks, pt, 6 / view.zoom);
      if (handle) style = handle in HANDLE_CURSOR ? HANDLE_CURSOR[handle as Handle] : "grab";
      else if (hit) style = tool === "text" && hit.kind === "text" ? "text" : "move";
    }
    if (tool === "crop" && crop) {
      const h = handleAt(crop, pt, 9 / view.zoom);
      style = h ? HANDLE_CURSOR[h] : contains(crop, pt) ? "move" : "crosshair";
    }
    if (style !== cursorStyle) setCursorStyle(style);
  }

  function cropFrom(d: Extract<Drag, { kind: "crop" }>, pt: Pt, shift: boolean): Rect {
    const ratio = props.current.cropRatio ?? (shift ? d.orig.w / Math.max(1, d.orig.h) : null);
    const { width: w, height: h } = props.current.doc;
    return dragCrop(d.orig, d.mode, d.start, pt, { w, h }, ratio);
  }

  function commitText() {
    const t = liveText.current;
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
        tabIndex={0}
        aria-label={t("ed.canvas")}
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => { if (drag.current) cancelDrag(); }}
        onPointerLeave={() => {
          cursor.current = null;
          props.current.onCursor(null);
          requestDraw();
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
      {text && (
        <textarea
          ref={textRef}
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

function squareEnd(start: Pt, end: Pt): Pt {
  const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  return { x: start.x + Math.sign(end.x - start.x || 1) * side, y: start.y + Math.sign(end.y - start.y || 1) * side };
}

function snapLine(start: Pt, end: Pt): Pt {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = Math.round(Math.atan2(end.y - start.y, end.x - start.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

let pattern: { theme: string; value: CanvasPattern } | null = null;

function checker(ctx: CanvasRenderingContext2D): CanvasPattern {
  const theme = document.documentElement.dataset.theme ?? "light";
  if (pattern?.theme === theme) return pattern.value;
  const tile = new OffscreenCanvas(16, 16);
  const t = tile.getContext("2d")!;
  const [a, b] = theme === "dark" ? ["#1d1d1c", "#141414"] : ["#ffffff", "#ecece8"];
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
    const r = intersect(fromPoints(d.start, d.now), { x: 0, y: 0, w: doc.width, h: doc.height });
    if (!r) return;
    if (d.tool === "box" || d.tool === "ellipse") drawMark(ctx, { id: "p", kind: d.tool, rect: r, color: opts.color, width: opts.width, opacity: opts.opacity, fill: opts.fillShape });
    else if (d.tool === "highlight") drawMark(ctx, { id: "p", kind: "highlight", rect: r, color: opts.highlight, opacity: opts.opacity });
    else if (d.tool === "erase") tint(r, "rgba(229, 72, 77, 0.22)", "#e5484d");
    else tint(r, "rgba(255, 211, 0, 0.18)", TALLY);
  }
  if (d.kind === "line") drawMark(ctx, { id: "p", kind: d.tool, a: d.start, b: d.now, color: opts.color, width: opts.width, opacity: opts.opacity });
  if (d.kind === "stroke") {
    drawMark(ctx, { id: "p", kind: "stroke", tool: d.tool === "erase" ? "pen" : d.tool, points: d.points, width: d.tool === "erase" ? opts.brush : opts.width, color: d.tool === "erase" ? "#E5484D" : d.tool === "marker" ? opts.highlight : opts.color, opacity: d.tool === "erase" ? 0.55 : opts.opacity });
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
  ctx.fillStyle = "rgba(10, 10, 10, 0.55)";
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

// The editor window: delete parts of an image (crop, erase, remove & fill,
// cut a strip, hide), add marks, get a perfect size, and save.

import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Copy,
  Circle,
  Crop,
  Download,
  Eraser,
  EyeOff,
  Hash,
  Highlighter,
  Pipette,
  Pencil,
  PenTool,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Square,
  Type,
  Undo2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { editorApi, errorText, imageUrl, shotUrl, type EditorInfo, type Rect, type SaveFormat } from "../shared/api";
import { intersect, type Pt } from "../shared/geometry";
import { useT, type Key } from "../shared/i18n";
import { initSettings } from "../shared/settings";
import { useTheme } from "../shared/theme";
import { Dialog, toast, Toasts } from "../shared/ui";
import { commit, newHistory, redo, shiftMark, undo, withOp, type Doc, type History, type Mark, type Mapping, type Op } from "./doc";
import { ExportPanel, SizePanel, ToolOptions } from "./Panels";
import { PrivacyPanel } from "./Privacy";
import { BaseRenderer, bitmapFromRgba, flatten, rgbaOf } from "./render";
import { Stage, type Options, type Tool, type View } from "./Stage";
import { fitCrop } from "./crop";

const params = new URLSearchParams(location.search);
const START_TARGET = params.get("target") ?? "";
const START_PANEL = params.get("panel");

const TOOLS: { id: Tool; icon: LucideIcon; key: string }[] = [
  { id: "select", icon: MousePointer2, key: "v" },
  { id: "crop", icon: Crop, key: "c" },
  { id: "erase", icon: Eraser, key: "e" },
  { id: "fill", icon: WandSparkles, key: "r" },
  { id: "cut", icon: Scissors, key: "x" },
  { id: "hide", icon: EyeOff, key: "h" },
];
const DRAW_TOOLS: { id: Tool; icon: LucideIcon; key: string }[] = [
  { id: "pen", icon: PenTool, key: "p" },
  { id: "pencil", icon: Pencil, key: "d" },
  { id: "marker", icon: Highlighter, key: "m" },
];
const MARK_TOOLS: { id: Tool; icon: LucideIcon; key: string }[] = [
  { id: "line", icon: Minus, key: "l" },
  { id: "arrow", icon: ArrowUpRight, key: "a" },
  { id: "box", icon: Square, key: "b" },
  { id: "ellipse", icon: Circle, key: "o" },
  { id: "text", icon: Type, key: "t" },
  { id: "step", icon: Hash, key: "n" },
  { id: "eyedropper", icon: Pipette, key: "i" },
];

const DEFAULT_OPTS: Options = {
  color: "#E5484D",
  highlight: "#FFE066",
  width: 4,
  opacity: 1,
  fillShape: false,
  hide: "pixelate",
  strength: 14,
  eraseMode: "brush",
  brush: 28,
  axis: "horizontal",
  textSize: 28,
  stepSize: 34,
};

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load the image (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.includes("svg")) return createImageBitmap(blob);
  // SVG (dev mocks only) has to go through an <img>.
  const img = new Image();
  const objectUrl = URL.createObjectURL(blob);
  try {
    img.src = objectUrl;
    await img.decode();
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Matches imaging::fit in Rust: scale to fit, centre, whole-pixel offsets. */
function fitMapping(iw: number, ih: number, w: number, h: number): Mapping {
  const s = Math.min(w / iw, h / ih);
  const nw = Math.min(w, Math.max(1, Math.round(iw * s)));
  const nh = Math.min(h, Math.max(1, Math.round(ih * s)));
  return { sx: nw / iw, sy: nh / ih, ox: Math.floor((w - nw) / 2), oy: Math.floor((h - nh) / 2) };
}

export function Editor() {
  useTheme();
  const t = useT();
  const [target, setTarget] = useState(START_TARGET);
  const [info, setInfo] = useState<EditorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [saved, setSaved] = useState<Doc | null>(null);
  const [version, setVersion] = useState(0);
  const renderer = useRef<BaseRenderer | null>(null);
  const base = useRef<OffscreenCanvas | null>(null);
  const [toolState, setToolState] = useState<Tool | "highlight">("pen");
  // Older editor sessions used the same marker icon for a rectangle tool.
  const tool = toolState === "highlight" ? "marker" : toolState;
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTS);
  const toolStyles = useRef<Partial<Record<Tool, Pick<Options, "width" | "opacity">>>>({
    pen: { width: 4, opacity: 1 }, pencil: { width: 2, opacity: 1 }, marker: { width: 24, opacity: 0.4 },
    line: { width: 4, opacity: 1 }, arrow: { width: 6, opacity: 1 }, box: { width: 4, opacity: 1 },
    ellipse: { width: 4, opacity: 1 },
  });
  const lastDrawingTool = useRef<Tool>("pen");
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const stageSize = useRef({ w: 800, h: 600 });
  /** Keep the image fitted to the window until the user zooms or pans. */
  const autoFit = useRef(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [format, setFormat] = useState<SaveFormat>("png");
  const [quality, setQuality] = useState(90);
  const [maxKb, setMaxKb] = useState(0);
  const [estimate, setEstimate] = useState<{ bytes: number; quality: number } | "tooBig" | null>(null);
  const [closing, setClosing] = useState(false);

  const doc = hist?.present ?? null;
  const dirty = !!hist && hist.present !== saved;
  const selectedMark = doc?.marks.find((m) => m.id === selected) ?? null;
  const optionsGesture = useRef<Doc | null>(null);
  const beginOptions = () => { optionsGesture.current ??= doc; };
  const endOptions = () => { optionsGesture.current = null; };
  const dpr = devicePixelRatio || 1;

  const fail = useCallback((e: unknown) => {
    const msg = errorText(e);
    toast({ text: msg.includes("too_big") ? t("ed.tooBig") : t("common.error", { msg }), error: true }, 6000);
  }, [t]);

  // ---- loading ----

  const load = useCallback(async (which: string) => {
    try {
      const i = await editorApi.info(which);
      const url = i.shot ? imageUrl(i.shot) : shotUrl(`mem/${which.split(":")[1]}`);
      const bmp = await loadBitmap(url);
      renderer.current = new BaseRenderer(bmp);
      base.current = renderer.current.render([]);
      const h = newHistory(bmp.width, bmp.height);
      bmp.close();
      setHist(h);
      setSaved(h.present);
      setSelected(null);
      setCrop(null);
      setToolState("pen");
      setError(null);
      setInfo(i);
      setFormat(i.format === "jpg" || i.format === "jpeg" ? "jpeg" : i.format === "webp" ? "webp" : "png");
      setVersion((v) => v + 1);
      autoFit.current = true;
      getCurrentWindow().setTitle(`${i.name} — AlgorithShot`).catch(() => {});
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    initSettings();
    load(START_TARGET);
  }, [load]);

  // Re-run the raster ops whenever they change (marks don't need this).
  useEffect(() => {
    if (!doc || !renderer.current) return;
    const next = renderer.current.render(doc.ops);
    if (next !== base.current) {
      base.current = next;
      setVersion((v) => v + 1);
    }
  }, [doc?.ops]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = useCallback((w: number, h: number) => {
    const s = stageSize.current;
    const zoom = Math.max(0.005, Math.min(Math.max(1, s.w - 64) / w, Math.max(1, s.h - 64) / h, 1 / dpr));
    setView({ zoom, x: Math.round((s.w - w * zoom) / 2), y: Math.round((s.h - h * zoom) / 2) });
  }, [dpr]);

  useEffect(() => {
    if (doc && autoFit.current) fit(doc.width, doc.height);
  }, [doc?.width, doc?.height, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitNow = () => {
    autoFit.current = true;
    if (doc) fit(doc.width, doc.height);
  };

  const zoomTo = (zoom: number) => {
    autoFit.current = false;
    const s = stageSize.current;
    const z = Math.min(32, Math.max(0.05, zoom));
    // Keep the middle of the stage still.
    setView((v) => ({ zoom: z, x: s.w / 2 - ((s.w / 2 - v.x) * z) / v.zoom, y: s.h / 2 - ((s.h / 2 - v.y) * z) / v.zoom }));
  };

  // ---- editing ----

  const applyOp = useCallback((op: Op) => {
    setHist((h) => {
      if (!h) return h;
      // Raster tools operate on everything visible, including paint strokes.
      const source = op.kind === "replace"
        ? { ...h.present, marks: [] }
        : h.present.marks.length ? withOp(h.present, { kind: "rasterize", marks: h.present.marks }) : h.present;
      return commit(h, withOp(source, op));
    });
    setSelected(null);
  }, []);
  const setMarks = useCallback((marks: Mark[], select?: string) => {
    setHist((h) => h && commit(h, { ...h.present, marks }));
    if (select) setSelected(select);
  }, []);

  const setTool = (next: Tool) => {
    if (busy) return;
    endOptions();
    setOpts((o) => {
      toolStyles.current[tool] = { width: o.width, opacity: o.opacity };
      return { ...o, ...toolStyles.current[next] };
    });
    if (["pen", "pencil", "marker", "line", "arrow", "box", "ellipse"].includes(next)) lastDrawingTool.current = next;
    setToolState(next);
    if (next !== "select") setSelected(null);
    if (next === "crop" && doc) setCrop(fitCrop({ x: 0, y: 0, w: doc.width, h: doc.height }, { w: doc.width, h: doc.height }, cropRatio));
    else setCrop(null);
  };

  // Changing colour or size with a mark selected restyles that mark.
  const onOpts = (patch: Partial<Options>) => {
    if (busy) return;
    setOpts((o) => Object.entries(patch).every(([key, value]) => o[key as keyof Options] === value) ? o : { ...o, ...patch });
    if (!selectedMark || !doc) return;
    const m = selectedMark;
    let next: Mark = m;
    const isHighlight = m.kind === "highlight" || (m.kind === "stroke" && m.tool === "marker");
    if (patch.color && !isHighlight && patch.color.toLowerCase() !== next.color.toLowerCase()) next = { ...next, color: patch.color };
    if (patch.highlight && isHighlight && patch.highlight.toLowerCase() !== next.color.toLowerCase()) next = { ...next, color: patch.highlight };
    if (patch.width !== undefined && "width" in next && patch.width !== next.width) next = { ...next, width: patch.width };
    if (patch.opacity !== undefined && next.kind !== "text" && next.kind !== "step" && patch.opacity !== (next.opacity ?? (next.kind === "highlight" ? 0.55 : 1))) next = { ...next, opacity: patch.opacity };
    if (patch.fillShape !== undefined && (next.kind === "box" || next.kind === "ellipse") && patch.fillShape !== !!next.fill) next = { ...next, fill: patch.fillShape };
    if (patch.textSize && next.kind === "text" && patch.textSize !== next.size) next = { ...next, size: patch.textSize };
    if (patch.stepSize && next.kind === "step" && patch.stepSize !== next.size) next = { ...next, size: patch.stepSize };
    if (next !== m) {
      const gestureStart = optionsGesture.current;
      setHist((h) => h && commit(h, { ...h.present, marks: h.present.marks.map((x) => x.id === m.id ? next : x) }, gestureStart));
    }
  };

  const fill = async (r: Rect) => {
    if (!doc || !renderer.current || busy) return;
    const b = flatten(renderer.current.render(doc.ops), doc.marks);
    const region = intersect({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }, { x: 0, y: 0, w: b.width, h: b.height })!;
    const hole = { x: r.x - region.x, y: r.y - region.y, w: r.w, h: r.h };
    setBusy(t("ed.working"));
    try {
      const buf = await editorApi.fill(rgbaOf(b, region), region.w, region.h, hole);
      applyOp({ kind: "patch", at: { x: r.x, y: r.y }, image: await bitmapFromRgba(buf, r.w, r.h) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const applySize = async (w: number, h: number, mode: "resize" | "fit", bg: number[]) => {
    if (!doc || !renderer.current || busy) return;
    const b = flatten(renderer.current.render(doc.ops), doc.marks);
    setBusy(t("ed.working"));
    try {
      const buf = await editorApi.resize(rgbaOf(b), b.width, b.height, w, h, mode, bg);
      const map = mode === "fit" ? fitMapping(b.width, b.height, w, h) : { sx: w / b.width, sy: h / b.height, ox: 0, oy: 0 };
      applyOp({ kind: "replace", image: await bitmapFromRgba(buf, w, h), map });
      autoFit.current = true;
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const applyCrop = () => {
    if (busy) return;
    if (crop && doc && (crop.w !== doc.width || crop.h !== doc.height || crop.x || crop.y)) {
      applyOp({ kind: "crop", rect: fitCrop(crop, { w: doc.width, h: doc.height }, cropRatio) });
      autoFit.current = true;
    }
    setTool("select");
  };

  // ---- output ----

  const finalImage = () => {
    const flat = flatten(renderer.current!.render(doc!.ops), doc!.marks);
    return { rgba: rgbaOf(flat), w: flat.width, h: flat.height };
  };

  const save = async (): Promise<boolean> => {
    if (!doc || !base.current || busy) return false;
    setBusy(t("ed.working"));
    try {
      const { rgba, w, h } = finalImage();
      const shot = await editorApi.save(rgba, w, h, target, format, quality, maxKb * 1024);
      setSaved(hist!.present);
      setTarget(`shot:${shot.id}`);
      setInfo((i) => (i ? { ...i, shot, name: shot.name, hasOriginal: true } : i));
      getCurrentWindow().setTitle(`${shot.name} — AlgorithShot`).catch(() => {});
      toast({ text: t("ed.saved") }, 2000);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveAs = async () => {
    if (!doc || busy) return;
    setBusy(t("ed.working"));
    try {
      const { rgba, w, h } = finalImage();
      const name = (info?.name ?? "Screenshot").replace(/\.[a-z]+$/i, "") + "." + (format === "jpeg" ? "jpg" : format);
      const path = await editorApi.saveAs(rgba, w, h, name, quality, maxKb * 1024);
      if (path) toast({ text: t("ed.saved") }, 2000);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!doc || busy) return;
    setBusy(t("ed.working"));
    try {
      const { rgba, w, h } = finalImage();
      await editorApi.copy(rgba, w, h);
      toast({ text: t("ed.copied") }, 1600);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const revert = async () => {
    const id = info?.shot?.id;
    if (!id || busy) return;
    setBusy(t("ed.working"));
    try {
      await editorApi.revert(id);
      await load(`shot:${id}`);
      toast({ text: t("ed.reverted") }, 2000);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  // File size, worked out a moment after the last change.
  useEffect(() => {
    if (!doc || !base.current) return;
    setEstimate(null);
    const id = window.setTimeout(async () => {
      try {
        const { rgba, w, h } = finalImage();
        setEstimate(await editorApi.estimate(rgba, w, h, format, quality, maxKb * 1024));
      } catch (e) {
        setEstimate(errorText(e).includes("too_big") ? "tooBig" : null);
      }
    }, 900);
    return () => window.clearTimeout(id);
  }, [doc, version, format, quality, maxKb]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- closing with unsaved changes ----

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested((e) => {
      if (dirtyRef.current) {
        e.preventDefault();
        setClosing(true);
      }
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  // ---- keyboard ----

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches("input, textarea, select, [contenteditable=true]") || closing || busy || !doc) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === "z" && !e.shiftKey) setHist((h) => h && undo(h));
    else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) setHist((h) => h && redo(h));
    else if (ctrl && k === "s") e.shiftKey ? saveAs() : save();
    else if (ctrl && k === "c") copy();
    else if (ctrl && k === "0") fitNow();
    else if (ctrl && k === "1") zoomTo(1 / dpr);
    else if (ctrl) return;
    else if (k === "escape") {
      if (tool === "crop") setTool("select");
      else if (selected) setSelected(null);
      else setTool("select");
    } else if (k === "enter" && tool === "crop") applyCrop();
    else if ((k === "delete" || k === "backspace") && selected) {
      setMarks(doc.marks.filter((m) => m.id !== selected));
      setSelected(null);
    } else if (k.startsWith("arrow") && selectedMark) {
      const step = e.shiftKey ? 10 : 1;
      const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
      const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
      setMarks(doc.marks.map((m) => (m.id === selected ? shiftMark(m, dx, dy) : m)), selected!);
    } else if (k === "+" || k === "=") zoomTo(view.zoom * 1.25);
    else if (k === "-") zoomTo(view.zoom / 1.25);
    else {
      const found = [...TOOLS, ...DRAW_TOOLS, ...MARK_TOOLS].find((x) => x.key === k);
      if (found) setTool(found.id);
      else if (k === "j") setTool("marker");
      else return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <div className="ed-message">
        <p>{t("common.error", { msg: error })}</p>
      </div>
    );
  }
  if (!doc || !info) {
    return (
      <div className="ed-message">
        <p className="muted">{t("ed.loading")}</p>
      </div>
    );
  }

  const zoomPct = Math.round(view.zoom * dpr * 100);
  const toolButton = (x: { id: Tool; icon: LucideIcon }, labelled = false) => (
    <button key={x.id} className={`ed-tool${labelled ? " ed-draw-tool" : ""}${tool === x.id ? " on" : ""}`} title={t(`ed.tool.${x.id}` as Key)} aria-label={t(`ed.tool.${x.id}` as Key)} aria-pressed={tool === x.id} disabled={!!busy} onClick={() => setTool(x.id)}>
      <x.icon size={18} />
      {labelled && <span>{t(`ed.tool.${x.id}` as Key).replace(/\s*\(.*\)$/, "")}</span>}
    </button>
  );

  return (
    <div className="ed">
      <header className="ed-top">
        <div className="ed-group ed-tools-primary">{TOOLS.map((x) => toolButton(x))}</div>
        <span className="ed-sep" />
        <div className="ed-group ed-tools-brushes">{DRAW_TOOLS.map((x) => toolButton(x, true))}</div>
        <span className="ed-sep" />
        <div className="ed-group ed-tools-drawing">{MARK_TOOLS.map((x) => toolButton(x))}</div>
        <span className="ed-sep" />
        <div className="ed-top-actions">
        <button className="icon-btn" title={t("ed.undo")} aria-label={t("ed.undo")} disabled={!!busy || !hist?.past.length} onClick={() => setHist((h) => h && undo(h))}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" title={t("ed.redo")} aria-label={t("ed.redo")} disabled={!!busy || !hist?.future.length} onClick={() => setHist((h) => h && redo(h))}>
          <Redo2 size={17} />
        </button>
        <span style={{ flex: 1 }} />
        <div className="ed-zoom">
          <button className="icon-btn" title={t("ed.zoomOut")} onClick={() => zoomTo(view.zoom / 1.25)}>
            <Minus size={16} />
          </button>
          <button className="ed-zoom-value measure" title={t("ed.actual")} onClick={() => zoomTo(1 / dpr)}>
            {zoomPct}%
          </button>
          <button className="icon-btn" title={t("ed.zoomIn")} onClick={() => zoomTo(view.zoom * 1.25)}>
            <Plus size={16} />
          </button>
          <button className="icon-btn" title={t("ed.fit")} onClick={fitNow}>
            <Maximize size={16} />
          </button>
        </div>
        <span className="ed-sep" />
        <button className="icon-btn" title={t("ed.copy")} aria-label={t("ed.copy")} disabled={!!busy} onClick={copy}>
          <Copy size={17} />
        </button>
        <button className="icon-btn" title={t("ed.saveAs")} aria-label={t("ed.saveAs")} disabled={!!busy} onClick={saveAs}>
          <Download size={17} />
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy}>
          {t("ed.save")}
        </button>
        </div>
      </header>

      <div className="ed-body">
        <Stage
          base={base.current}
          version={version}
          doc={doc}
          tool={tool}
          opts={opts}
          disabled={!!busy}
          onPickColor={(color) => {
            setOpts((o) => ({ ...o, color, highlight: color }));
            setTool(lastDrawingTool.current);
          }}
          view={view}
          onView={(v) => {
            autoFit.current = false;
            setView(v);
          }}
          selected={selected}
          onSelect={setSelected}
          crop={crop}
          onCrop={setCrop}
          cropRatio={cropRatio}
          onOp={applyOp}
          onFill={fill}
          onMarks={setMarks}
          onCursor={setCursor}
          onStageSize={(w, h) => {
            stageSize.current = { w, h };
            if (autoFit.current && doc) fit(doc.width, doc.height);
          }}
        />
        <aside className="ed-side">
          <fieldset className="ed-side-controls" disabled={!!busy}>
          <div
            className="ed-inspector"
            onPointerDownCapture={beginOptions}
            onPointerUp={endOptions}
            onPointerCancel={endOptions}
            onFocusCapture={beginOptions}
            onBlur={endOptions}
            onKeyDownCapture={(e) => { if (e.target instanceof HTMLInputElement && e.target.type === "range") beginOptions(); }}
            onKeyUp={(e) => { if (e.target instanceof HTMLInputElement && e.target.type === "range") endOptions(); }}
          >
          <ToolOptions
            tool={tool}
            opts={opts}
            onOpts={onOpts}
            selectedMark={selectedMark}
            crop={crop}
            onCrop={(r) => setCrop(fitCrop(r, { w: doc.width, h: doc.height }, cropRatio))}
            cropRatio={cropRatio}
            onCropRatio={(r) => {
              setCropRatio(r);
              if (r && crop && doc) {
                setCrop(fitCrop(crop, { w: doc.width, h: doc.height }, r));
              }
            }}
            onApplyCrop={applyCrop}
            onCancelCrop={() => setTool("select")}
            docSize={{ w: doc.width, h: doc.height }}
          />
          </div>
          <PrivacyPanel
            base={base.current}
            version={version}
            open={START_PANEL === "privacy"}
            onHide={(rects, style) => {
              let next = hist!.present;
              if (next.marks.length) next = withOp(next, { kind: "rasterize", marks: next.marks });
              for (const rect of rects) next = withOp(next, { kind: "hide", rect, style, strength: Math.max(14, opts.strength) });
              setHist((h) => h && commit(h, next));
            }}
          />
          <SizePanel size={{ w: doc.width, h: doc.height }} onApply={applySize} />
          <ExportPanel format={format} onFormat={setFormat} quality={quality} onQuality={setQuality} maxKb={maxKb} onMaxKb={setMaxKb} estimate={estimate} />
          {info.hasOriginal && (
            <button className="btn btn-ghost wide" onClick={revert}>
              <RotateCcw size={15} /> {t("ed.revert")}
            </button>
          )}
          </fieldset>
        </aside>
      </div>

      <footer className="ed-status edge">
        <span className="ed-name">{info.name}</span>
        <span className="measure">
          {doc.width} × {doc.height}
        </span>
        {cursor && (
          <span className="measure">
            {cursor.x}, {cursor.y}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {busy && <span className="ed-busy">{busy}</span>}
        {dirty && <span className="ed-dirty">●</span>}
      </footer>

      {closing && (
        <Dialog
          title={t("ed.unsaved.title")}
          onCancel={() => setClosing(false)}
          actions={
            <>
              <button className="btn" onClick={() => setClosing(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-danger" onClick={() => getCurrentWindow().destroy()}>
                {t("ed.unsaved.discard")}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (await save()) getCurrentWindow().destroy();
                }}
              >
                {t("ed.save")}
              </button>
            </>
          }
        >
          <p>{t("ed.unsaved.body")}</p>
        </Dialog>
      )}
      <Toasts />
    </div>
  );
}

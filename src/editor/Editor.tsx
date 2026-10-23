// The editor window: delete parts of an image (crop, erase, remove & fill,
// cut a strip, hide), add marks, get a perfect size, and save.

import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Copy,
  Crop,
  Eraser,
  EyeOff,
  Hash,
  Highlighter,
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
const MARK_TOOLS: { id: Tool; icon: LucideIcon; key: string }[] = [
  { id: "arrow", icon: ArrowUpRight, key: "a" },
  { id: "box", icon: Square, key: "b" },
  { id: "highlight", icon: Highlighter, key: "m" },
  { id: "text", icon: Type, key: "t" },
  { id: "step", icon: Hash, key: "n" },
];

const DEFAULT_OPTS: Options = {
  color: "#E5484D",
  highlight: "#FFE066",
  width: 6,
  hide: "pixelate",
  strength: 14,
  eraseMode: "box",
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
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return createImageBitmap(img);
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
  const [tool, setToolState] = useState<Tool>("select");
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTS);
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
      setHist(h);
      setSaved(h.present);
      setInfo(i);
      setFormat(i.format === "jpg" || i.format === "jpeg" ? "jpeg" : i.format === "webp" ? "webp" : "png");
      setVersion((v) => v + 1);
      autoFit.current = true;
      getCurrentWindow().setTitle(`${i.name} — Algorithco Shot`).catch(() => {});
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
    base.current = renderer.current.render(doc.ops);
    setVersion((v) => v + 1);
  }, [doc?.ops]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = useCallback((w: number, h: number) => {
    const s = stageSize.current;
    const zoom = Math.min((s.w - 64) / w, (s.h - 64) / h, 1 / dpr);
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

  const applyOp = useCallback((op: Op) => setHist((h) => h && commit(h, withOp(h.present, op))), []);
  const setMarks = useCallback((marks: Mark[], select?: string) => {
    setHist((h) => h && commit(h, { ...h.present, marks }));
    if (select) setSelected(select);
  }, []);

  const setTool = (next: Tool) => {
    setToolState(next);
    if (next !== "select") setSelected(null);
    if (next === "crop" && doc) setCrop({ x: 0, y: 0, w: doc.width, h: doc.height });
    else setCrop(null);
  };

  // Changing colour or size with a mark selected restyles that mark.
  const onOpts = (patch: Partial<Options>) => {
    setOpts((o) => ({ ...o, ...patch }));
    if (!selectedMark || !doc) return;
    const m = selectedMark;
    let next: Mark = m;
    if (patch.color && (m.kind === "arrow" || m.kind === "box" || m.kind === "text" || m.kind === "step")) next = { ...next, color: patch.color } as Mark;
    if (patch.highlight && m.kind === "highlight") next = { ...m, color: patch.highlight };
    if (patch.width && (m.kind === "arrow" || m.kind === "box")) next = { ...m, width: patch.width };
    if (patch.textSize && m.kind === "text") next = { ...m, size: patch.textSize };
    if (patch.stepSize && m.kind === "step") next = { ...m, size: patch.stepSize };
    if (next !== m) setMarks(doc.marks.map((x) => (x.id === m.id ? next : x)), m.id);
  };

  const fill = async (r: Rect) => {
    const b = base.current;
    if (!b) return;
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
    const b = base.current;
    if (!b) return;
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
    if (crop && doc && (crop.w !== doc.width || crop.h !== doc.height || crop.x || crop.y)) {
      applyOp({ kind: "crop", rect: crop });
      autoFit.current = true;
    }
    setTool("select");
  };

  // ---- output ----

  const finalImage = () => {
    const flat = flatten(base.current!, doc!.marks);
    return { rgba: rgbaOf(flat), w: flat.width, h: flat.height };
  };

  const save = async (): Promise<boolean> => {
    if (!doc || !base.current) return false;
    setBusy(t("ed.working"));
    try {
      const { rgba, w, h } = finalImage();
      const shot = await editorApi.save(rgba, w, h, target, format, quality, maxKb * 1024);
      setSaved(hist!.present);
      setTarget(`shot:${shot.id}`);
      setInfo((i) => (i ? { ...i, shot, name: shot.name, hasOriginal: true } : i));
      getCurrentWindow().setTitle(`${shot.name} — Algorithco Shot`).catch(() => {});
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
    if (!doc) return;
    try {
      const { rgba, w, h } = finalImage();
      const name = (info?.name ?? "Screenshot").replace(/\.[a-z]+$/i, "") + "." + (format === "jpeg" ? "jpg" : format);
      const path = await editorApi.saveAs(rgba, w, h, name, quality, maxKb * 1024);
      if (path) toast({ text: t("ed.saved") }, 2000);
    } catch (e) {
      fail(e);
    }
  };

  const copy = async () => {
    if (!doc) return;
    try {
      const { rgba, w, h } = finalImage();
      await editorApi.copy(rgba, w, h);
      toast({ text: t("ed.copied") }, 1600);
    } catch (e) {
      fail(e);
    }
  };

  const revert = async () => {
    const id = info?.shot?.id;
    if (!id) return;
    try {
      await editorApi.revert(id);
      await load(`shot:${id}`);
      toast({ text: t("ed.reverted") }, 2000);
    } catch (e) {
      fail(e);
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
    if ((e.target as HTMLElement).matches("input, textarea, select") || closing || !doc) return;
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
      const found = [...TOOLS, ...MARK_TOOLS].find((x) => x.key === k);
      if (found) setTool(found.id);
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
  const toolButton = (x: { id: Tool; icon: LucideIcon }) => (
    <button key={x.id} className={`ed-tool${tool === x.id ? " on" : ""}`} title={t(`ed.tool.${x.id}` as Key)} aria-pressed={tool === x.id} onClick={() => setTool(x.id)}>
      <x.icon size={18} />
    </button>
  );

  return (
    <div className="ed">
      <header className="ed-top">
        <div className="ed-group">{TOOLS.map(toolButton)}</div>
        <span className="ed-sep" />
        <div className="ed-group">{MARK_TOOLS.map(toolButton)}</div>
        <span className="ed-sep" />
        <button className="icon-btn" title={t("ed.undo")} disabled={!hist?.past.length} onClick={() => setHist((h) => h && undo(h))}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" title={t("ed.redo")} disabled={!hist?.future.length} onClick={() => setHist((h) => h && redo(h))}>
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
        <button className="btn" onClick={copy}>
          <Copy size={15} /> {t("ed.copy")}
        </button>
        <button className="btn" onClick={saveAs}>
          {t("ed.saveAs")}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy}>
          {t("ed.save")}
        </button>
      </header>

      <div className="ed-body">
        <Stage
          base={base.current}
          version={version}
          doc={doc}
          tool={tool}
          opts={opts}
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
          <ToolOptions
            tool={tool}
            opts={opts}
            onOpts={onOpts}
            selectedMark={selectedMark}
            crop={crop}
            onCrop={setCrop}
            cropRatio={cropRatio}
            onCropRatio={(r) => {
              setCropRatio(r);
              if (r && crop && doc) {
                // Fit the biggest box of that ratio, centred in the current one.
                let w = crop.w;
                let h = Math.round(w / r);
                if (h > crop.h) {
                  h = crop.h;
                  w = Math.round(h * r);
                }
                setCrop({ x: Math.round(crop.x + (crop.w - w) / 2), y: Math.round(crop.y + (crop.h - h) / 2), w, h });
              }
            }}
            onApplyCrop={applyCrop}
            onCancelCrop={() => setTool("select")}
            docSize={{ w: doc.width, h: doc.height }}
          />
          <PrivacyPanel
            base={base.current}
            version={version}
            open={START_PANEL === "privacy"}
            onHide={(rects, style) => {
              let next = hist!.present;
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
        </aside>
      </div>

      <footer className="ed-status edge">
        <span>{info.name}</span>
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

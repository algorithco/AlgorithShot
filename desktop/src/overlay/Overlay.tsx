// The capture overlay page. One stays loaded per monitor, hidden; on
// "overlay:start" it draws the frozen screen, then asks Rust to show it.

import { listen } from "@tauri-apps/api/event";
import {
  AppWindow,
  Check,
  Copy,
  Download,
  Monitor,
  MonitorSmartphone,
  PenLine,
  Pin,
  Pipette,
  QrCode,
  Ratio,
  Ruler,
  ScanText,
  SquareDashed,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api, errorText, shotUrl, type CommitAction, type MonitorInfo, type Rect, type WindowInfo } from "../shared/api";
import { useT, type Key } from "../shared/i18n";
import { initSettings } from "../shared/settings";
import { Engine, type Mode, type View } from "./engine";

type Start = {
  sessionId: number;
  mode: Mode;
  monitor: MonitorInfo;
  windows: WindowInfo[];
  cursor: [number, number] | null;
  last: Rect | null;
  snap: boolean;
  highlight: boolean;
  elements: boolean;
};

const MODES: { id: Mode; icon: LucideIcon; label: Key; key: string }[] = [
  { id: "region", icon: SquareDashed, label: "ov.region", key: "R" },
  { id: "window", icon: AppWindow, label: "ov.window", key: "W" },
  { id: "screen", icon: Monitor, label: "ov.screen", key: "F" },
  { id: "fixed", icon: Ratio, label: "ov.fixed", key: "" },
];

const TOOLS: { id: Mode; icon: LucideIcon; label: Key; key: string }[] = [
  { id: "text", icon: ScanText, label: "ov.text", key: "T" },
  { id: "qr", icon: QrCode, label: "ov.qr", key: "Q" },
  { id: "color", icon: Pipette, label: "ov.color", key: "C" },
  { id: "ruler", icon: Ruler, label: "ov.ruler", key: "M" },
];

/** Labels above a frame start below this (CSS px) so the toolbar can't hide them. */
const TOOLBAR_SPACE = 66;

const SIZES: [number, number][] = [
  [1920, 1080],
  [1600, 900],
  [1280, 720],
  [1080, 1080],
  [1080, 1350],
  [1200, 630],
  [1200, 675],
  [800, 600],
];

export function Overlay() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<Start | null>(null);
  const [session, setSession] = useState<Start | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [menu, setMenu] = useState<null | "fixed" | "timer">(null);
  const [editing, setEditing] = useState(false);
  // "Copied" shows on the text bar for a moment after copying.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);

  const commit = useCallback((rect: Rect, action: CommitAction, allScreens = false) => {
    const s = sessionRef.current;
    if (!s) return;
    api.captureCommit({ sessionId: s.sessionId, monitorId: s.monitor.id, rect, action, allScreens }).catch((e) => {
      console.error(errorText(e));
    });
  }, []);

  const cancel = useCallback(() => {
    const s = sessionRef.current;
    if (s) api.captureCancel(s.sessionId);
  }, []);

  useEffect(() => {
    initSettings();
    // Element lookups go one at a time; the newest point wins.
    let asking = false;
    let wanted: { x: number; y: number } | null = null;
    const askElements = async () => {
      const s = sessionRef.current;
      if (asking || !wanted || !s?.elements) return;
      const at = wanted;
      wanted = null;
      asking = true;
      try {
        const found = await api.elementAt(s.sessionId, s.monitor.id, Math.round(at.x), Math.round(at.y));
        if (sessionRef.current?.sessionId === s.sessionId) engine.setElements(found, at);
      } catch {
        // No element info for this app: window snapping still works.
      } finally {
        asking = false;
        if (wanted) askElements();
      }
    };
    const engine = new Engine(canvasRef.current!, {
      change: setView,
      commit: (rect, action) => commit(rect, action),
      cancel,
      color: (hex) => {
        api.copyColor(hex);
        cancel();
      },
      readText: (rect) => {
        const s = sessionRef.current;
        if (!s) return;
        const current = () => sessionRef.current?.sessionId === s.sessionId;
        api.readScreenText(s.sessionId, s.monitor.id, rect).then(
          (lines) => current() && engine.setText(rect, lines),
          (e) => current() && engine.setText(rect, null, errorText(e)),
        );
      },
      copyText: (text) => {
        api.copyText(text).then(
          () => {
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
          },
          (e) => console.error(errorText(e)),
        );
      },
      elementsAt: (p) => {
        wanted = p;
        askElements();
      },
    });
    engineRef.current = engine;

    const start = async (s: Start) => {
      sessionRef.current = s;
      setSession(s);
      setMenu(null);
      setEditing(false);
      try {
        const { w, h } = s.monitor.rect;
        const res = await fetch(shotUrl(`frame/${s.sessionId}/${s.monitor.id}`));
        if (!res.ok) throw new Error(`frame ${res.status}`);
        // The app sends raw RGBA; the dev mocks send an image file.
        const pixels = res.headers.get("content-type")?.startsWith("image/")
          ? await decodeToPixels(await res.blob(), w, h)
          : new Uint8ClampedArray(await res.arrayBuffer());
        const bitmap = await createImageBitmap(new ImageData(pixels, w, h));
        if (sessionRef.current?.sessionId !== s.sessionId) {
          bitmap.close();
          return;
        }
        engine.load({
          bitmap,
          pixels,
          width: w,
          height: h,
          windows: s.windows,
          mode: s.mode,
          cursor: s.cursor,
          snap: s.snap,
          highlight: s.highlight,
        });
        requestAnimationFrame(() => api.overlayReady(s.sessionId, s.monitor.id));
      } catch (e) {
        console.error("overlay start", errorText(e));
        api.captureCancel(s.sessionId);
      }
    };

    const end = () => {
      engine.clear();
      sessionRef.current = null;
      setSession(null);
      setView(null);
      setMenu(null);
      setEditing(false);
      // Hide only once the cleared frame is on screen, so the next capture
      // never shows this one for a moment.
      let done = false;
      const hide = () => {
        if (!done) {
          done = true;
          api.overlayHide();
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(hide));
      setTimeout(hide, 120);
    };

    const subs = [
      listen<Start>("overlay:start", (e) => start(e.payload)),
      listen<number>("overlay:end", () => end()),
      listen<string>("overlay:mode", (e) => engine.setMode(e.payload as Mode)),
    ];

    const onKey = (e: KeyboardEvent) => {
      if (!engine.loaded) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (engine.key(e)) {
        e.preventDefault();
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      subs.forEach((p) => p.then((un) => un()));
    };
  }, [commit, cancel]);

  const picked = view?.text?.picked ?? 0;
  useEffect(() => setCopied(false), [picked, view?.sel]);

  const engine = engineRef.current;
  const r = view?.ratio ?? 1;
  const css = (v: number) => v / r;
  const busy = view && (view.phase === "draw" || view.phase === "move" || view.phase === "resize" || view.phase === "measure");

  const setMode = (m: Mode) => {
    setMenu(null);
    engine?.setMode(m);
  };

  const hint = (): string => {
    if (!view) return "";
    if (view.phase === "selected") return t("ov.hint.selected");
    if (view.phase === "text") return t("ov.hint.pick");
    if (view.mode === "region" && !session?.highlight) return t("ov.hint.regionDraw");
    return t(`ov.hint.${view.mode}` as Key);
  };

  return (
    <div className="ov" onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        className="ov-canvas"
        onPointerDown={(e) => {
          setMenu(null);
          if (e.button === 2) engine?.rightClick();
          else engine?.down(e.nativeEvent);
        }}
        onPointerMove={(e) => engine?.move(e.nativeEvent)}
        onPointerUp={(e) => engine?.up(e.nativeEvent)}
        onDoubleClick={(e) => engine?.doubleClick(e.nativeEvent)}
        onWheel={(e) => engine?.wheel(e.nativeEvent)}
      />

      {session && view && !busy && (
        <div className="ov-toolbar" role="toolbar">
          {MODES.map((m) => (
            <button
              key={m.id}
              className="ov-tool"
              aria-pressed={view.mode === m.id}
              title={m.key ? `${t(m.label)} (${m.key})` : t(m.label)}
              onClick={() => (m.id === "fixed" ? setMenu(menu === "fixed" ? null : "fixed") : setMode(m.id))}
            >
              <m.icon size={17} />
              <span>{m.id === "fixed" && view.mode === "fixed" && engine ? `${engine.fixed.w} × ${engine.fixed.h}` : t(m.label)}</span>
            </button>
          ))}
          <span className="ov-sep" />
          {TOOLS.map((m) => (
            <button
              key={m.id}
              className="ov-tool icon-only"
              aria-pressed={view.mode === m.id}
              title={`${t(m.label)} (${m.key})`}
              onClick={() => setMode(m.id)}
            >
              <m.icon size={17} />
            </button>
          ))}
          <span className="ov-sep" />
          <button className="ov-tool icon-only" title={t("ov.timer")} aria-pressed={menu === "timer"} onClick={() => setMenu(menu === "timer" ? null : "timer")}>
            <Timer size={17} />
          </button>
          {view.mode === "screen" && (
            <button className="ov-tool" onClick={() => commit({ x: 0, y: 0, w: view.width, h: view.height }, "done", true)}>
              <MonitorSmartphone size={17} />
              <span>{t("ov.allScreens")}</span>
            </button>
          )}
          <button className="ov-tool icon-only" title={t("ov.close")} onClick={cancel}>
            <X size={17} />
          </button>

          {menu === "fixed" && (
            <div className="ov-menu" style={{ left: 0 }}>
              {SIZES.map(([w, h]) => (
                <button
                  key={`${w}x${h}`}
                  onClick={() => {
                    setMenu(null);
                    engine?.setFixed(w, h);
                  }}
                >
                  <span className="measure">
                    {w} × {h}
                  </span>
                </button>
              ))}
            </div>
          )}
          {menu === "timer" && (
            <div className="ov-menu" style={{ right: 40 }}>
              {[3, 5, 10].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    const mode = view.mode === "color" || view.mode === "ruler" ? "region" : view.mode;
                    cancel();
                    api.captureStart(mode, s);
                  }}
                >
                  {t("ov.timerSeconds", { n: s })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view && view.phase === "idle" && view.hover && view.mode !== "screen" && view.hoverLabel && (
        <div className="ov-label" style={labelPos(view.hover, view.height)}>
          {view.hoverLabel.length > 60 ? `${view.hoverLabel.slice(0, 60)}…` : view.hoverLabel}
          <span className="measure">
            {view.hover.w} × {view.hover.h}
          </span>
        </div>
      )}

      {view?.sel && view.phase !== "idle" && view.phase !== "press" && view.phase !== "text" && (
        <SizeLabel
          sel={view.sel}
          ratio={r}
          height={view.height}
          editing={editing}
          title={t("ov.typeSize")}
          onEdit={() => setEditing(true)}
          onDone={(w, h) => {
            setEditing(false);
            if (w && h) engine?.setSize(w, h);
          }}
        />
      )}

      {view?.sel && view.phase === "selected" && (
        <div className="ov-actions" style={actionsPos(view.sel, r, view.width, view.height)}>
          <ActionButton icon={Pin} label={t("ov.act.pin")} onClick={() => commit(view.sel!, "pin")} />
          <ActionButton icon={ScanText} label={t("ov.act.text")} onClick={() => engine?.readText(view.sel!)} />
          <ActionButton icon={QrCode} label={t("ov.act.qr")} onClick={() => commit(view.sel!, "qr")} />
          <ActionButton icon={PenLine} label={t("ov.act.edit")} onClick={() => commit(view.sel!, "edit")} />
          <ActionButton icon={Download} label={t("ov.act.saveAs")} onClick={() => commit(view.sel!, "save_as")} />
          <ActionButton icon={Copy} label={t("ov.act.copy")} onClick={() => commit(view.sel!, "copy")} />
          <button className="ov-done" title={t("ov.act.done")} onClick={() => commit(view.sel!, "done")}>
            <Check size={18} strokeWidth={2.6} />
          </button>
        </div>
      )}

      {view?.sel && view.phase === "text" && view.text && (
        <div className="ov-actions ov-textbar" style={textBarPos(view.sel, r, view.width, view.height)}>
          {view.text.state === "ready" ? (
            <>
              <span className="ov-textbar-note">{picked ? t("ov.pick.picked", { n: picked }) : t("ov.pick.none")}</span>
              {picked > 0 && (
                <button className="ov-textbtn" onClick={() => engine?.copyText(true)}>
                  {t("ov.pick.copyAll")}
                </button>
              )}
              <button className="ov-textbtn primary" onClick={() => engine?.copyText()}>
                {copied ? <Check size={16} strokeWidth={2.6} /> : <Copy size={16} />}
                <span>{copied ? t("ov.pick.copied") : picked ? t("ov.pick.copy") : t("ov.pick.copyAll")}</span>
              </button>
            </>
          ) : (
            <span className="ov-textbar-note" role="status">
              {view.text.state === "reading" ? t("ov.pick.reading") : view.text.state === "empty" ? t("ov.pick.empty") : t("ov.pick.failed", { error: view.text.error })}
            </span>
          )}
          <button className="ov-act" title={t("ov.close")} aria-label={t("ov.close")} onClick={cancel}>
            <X size={17} />
          </button>
        </div>
      )}

      {session && view && !busy && <div className="ov-hint">{hint()}</div>}
    </div>
  );

  // Above the frame, unless that would run into the toolbar or off screen.
  function labelPos(rect: Rect, height: number): CSSProperties {
    const top = css(rect.y) - 30;
    return { left: Math.max(6, css(rect.x)), top: top < TOOLBAR_SPACE ? Math.min(css(rect.y) + 8, css(height) - 36) : top };
  }
}

async function decodeToPixels(blob: Blob, w: number, h: number): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function actionsPos(sel: Rect, ratio: number, width: number, height: number): CSSProperties {
  const barW = 7 * 36 + 16;
  const barH = 44;
  const right = (sel.x + sel.w) / ratio;
  let top = (sel.y + sel.h) / ratio + 12;
  if (top + barH > height / ratio - 8) top = sel.y / ratio - barH - 12;
  if (top < 8) top = (sel.y + sel.h) / ratio - barH - 10;
  const left = Math.min(Math.max(8, right - barW), width / ratio - barW - 8);
  return { left, top };
}

/** Under the area, right edges lined up; above it when there's no room below. */
function textBarPos(sel: Rect, ratio: number, width: number, height: number): CSSProperties {
  const barH = 44;
  const roomRight = width / ratio - (sel.x + sel.w) / ratio;
  let top = (sel.y + sel.h) / ratio + 12;
  if (top + barH > height / ratio - 8) top = sel.y / ratio - barH - 12;
  if (top < 8) top = (sel.y + sel.h) / ratio - barH - 10;
  // A bar about this wide fits left of the area's right edge; otherwise keep it on screen from the left.
  return (sel.x + sel.w) / ratio > 440 ? { right: Math.max(8, roomRight), top } : { left: 8, top };
}

function ActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button className="ov-act" title={label} aria-label={label} onClick={onClick}>
      <Icon size={17} />
    </button>
  );
}

function SizeLabel({
  sel,
  ratio,
  height,
  editing,
  title,
  onEdit,
  onDone,
}: {
  sel: Rect;
  ratio: number;
  height: number;
  editing: boolean;
  title: string;
  onEdit: () => void;
  onDone: (w: number | null, h: number | null) => void;
}) {
  const [w, setW] = useState(String(sel.w));
  const [h, setH] = useState(String(sel.h));
  useEffect(() => {
    if (!editing) {
      setW(String(sel.w));
      setH(String(sel.h));
    }
  }, [sel.w, sel.h, editing]);

  let top = sel.y / ratio - 34;
  if (top < TOOLBAR_SPACE) top = Math.min(sel.y / ratio + 8, height / ratio - 40);
  const style: CSSProperties = { left: Math.max(6, sel.x / ratio - 3), top };

  if (!editing) {
    return (
      <button className="ov-size measure" style={style} title={title} onClick={onEdit}>
        {sel.w} <span>×</span> {sel.h}
      </button>
    );
  }
  const submit = () => onDone(parseInt(w, 10) || null, parseInt(h, 10) || null);
  const onKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onDone(null, null);
  };
  return (
    <div className="ov-size editing measure" style={style}>
      <input autoFocus value={w} inputMode="numeric" onChange={(e) => setW(e.target.value.replace(/\D/g, ""))} onKeyDown={onKey} onFocus={(e) => e.target.select()} />
      <span>×</span>
      <input value={h} inputMode="numeric" onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} onKeyDown={onKey} onFocus={(e) => e.target.select()} />
      <button onClick={submit} aria-label="OK">
        <Check size={14} />
      </button>
    </div>
  );
}

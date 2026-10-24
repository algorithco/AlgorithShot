// A pinned screenshot: always on top, drag to move, wheel to zoom,
// Ctrl+wheel for opacity, double-click or Esc to close.

import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Copy, Maximize, PenLine, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText, shotUrl } from "../shared/api";
import { useT } from "../shared/i18n";
import { initSettings } from "../shared/settings";
import { toast, Toasts } from "../shared/ui";

const PAD = 10;
const params = new URLSearchParams(location.search);
const id = params.get("id") ?? "";
const pxW = Number(params.get("w")) || 400;
const pxH = Number(params.get("h")) || 300;

export function Pin() {
  const t = useT();
  const win = getCurrentWindow();
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shown = useRef(false);

  const close = () => {
    api.pinClosed(id);
    win.close();
  };

  useEffect(() => {
    initSettings();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.ctrlKey && e.key.toLowerCase() === "c") api.tempCopy(id).then(() => toast({ text: t("common.copied") }, 1500));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window size follows the zoom: image in device pixels / DPI, plus padding.
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    win.setSize(new LogicalSize((pxW * zoom) / dpr + PAD * 2, (pxH * zoom) / dpr + PAD * 2));
  }, [zoom, win]);

  const dpr = window.devicePixelRatio || 1;
  const run = (fn: () => Promise<unknown>, done?: string) => {
    setMenu(null);
    fn()
      .then(() => done && toast({ text: done }, 1500))
      .catch((e) => toast({ text: t("common.error", { msg: errorText(e) }), error: true }));
  };

  return (
    <div
      className="pin"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onWheel={(e) => {
        if (e.ctrlKey) setOpacity((o) => Math.min(1, Math.max(0.2, o + (e.deltaY < 0 ? 0.1 : -0.1))));
        else setZoom((z) => Math.min(4, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
      }}
    >
      <img
        src={shotUrl(`mem/${id}`)}
        alt=""
        draggable={false}
        style={{ width: (pxW * zoom) / dpr, height: (pxH * zoom) / dpr, opacity }}
        onLoad={() => {
          if (!shown.current) {
            shown.current = true;
            win.show();
          }
        }}
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) win.startDragging();
        }}
        onDoubleClick={close}
      />
      {zoom !== 1 && <div className="pin-zoom measure">{Math.round(zoom * 100)}%</div>}
      {menu && (
        <div className="pin-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} onMouseLeave={() => setMenu(null)}>
          <button onClick={() => run(() => api.tempCopy(id), t("common.copied"))}>
            <Copy size={15} /> {t("pin.copy")}
          </button>
          <button onClick={() => run(() => api.tempSave(id), t("card.saved"))}>
            <Save size={15} /> {t("pin.save")}
          </button>
          <button onClick={() => run(() => api.openEditor(`temp:${id}`))}>
            <PenLine size={15} /> {t("pin.edit")}
          </button>
          <button onClick={() => run(async () => setZoom(1))}>
            <Maximize size={15} /> {t("pin.actualSize")}
          </button>
          <div className="pin-opacity">
            <span>{t("pin.opacity")}</span>
            {[1, 0.75, 0.5].map((o) => (
              <button key={o} aria-pressed={opacity === o} onClick={() => setOpacity(o)}>
                {Math.round(o * 100)}%
              </button>
            ))}
          </div>
          <button onClick={close}>
            <X size={15} /> {t("pin.close")}
          </button>
        </div>
      )}
      <Toasts />
    </div>
  );
}

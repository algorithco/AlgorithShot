import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type HotkeyStatus } from "./api";
import { shortcutFromEvent } from "./format";
import { useT } from "./i18n";
import { Keys } from "./ui";

export function HotkeyInput({ value, status, onChange, label, translate }: {
  value: string;
  status?: HotkeyStatus;
  onChange: (value: string) => void;
  label?: string;
  translate?: ReturnType<typeof useT>;
}) {
  const fallback = useT();
  const t = translate ?? fallback;
  const [recording, setRecording] = useState(false);
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    let active = true;
    let ready = false;
    let unlisten: (() => void) | undefined;
    setArmed(false);
    setFailed(false);
    const finish = (key: string) => {
      if (!active || !ready) return;
      ready = false;
      changeRef.current(key);
      setRecording(false);
    };
    const take = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setRecording(false); return; }
      const key = shortcutFromEvent(event);
      if (key) finish(key);
    };
    const up = (event: KeyboardEvent) => { if (event.code === "PrintScreen") take(event); };
    void (async () => {
      const stop = await listen<string>("hotkey:record", (event) => finish(event.payload));
      if (!active) { stop(); return; }
      unlisten = stop;
      await api.hotkeysSuspend(true);
      if (!active) { await api.hotkeysSuspend(false); return; }
      ready = true;
      setArmed(true);
    })().catch(() => { if (active) { setFailed(true); setRecording(false); } });
    window.addEventListener("keydown", take, true);
    window.addEventListener("keyup", up, true);
    return () => {
      active = false;
      window.removeEventListener("keydown", take, true);
      window.removeEventListener("keyup", up, true);
      unlisten?.();
      void api.hotkeysSuspend(false).catch(() => {});
    };
  }, [recording]);

  return (
    <div className="hotkey">
      <button type="button" className={`hotkey-box${recording ? " recording" : ""}`} aria-label={label ?? t("set.hotkey")} aria-pressed={recording} onClick={() => setRecording(true)} onBlur={() => setRecording(false)}>
        {recording ? t(armed ? "set.hotkeyPress" : "set.hotkeyArming") : value ? <Keys value={value} /> : <span className="muted">{t("set.hotkeyNone")}</span>}
      </button>
      {value && !recording && <button type="button" className="icon-btn" aria-label={`${t("set.hotkeyClear")}: ${label ?? t("set.hotkey")}`} title={t("set.hotkeyClear")} onClick={() => onChange("")}><X size={15} /></button>}
      {status && !status.ok && <span className="hotkey-warn" title={status.error ?? ""}><AlertTriangle size={15} />{t("set.hotkeyTaken")}</span>}
      {failed && <span className="hotkey-warn" role="alert">{t("set.hotkeyRecordError")}</span>}
    </div>
  );
}

import { AlertCircle, Check, Circle, FolderOpen, LoaderCircle, Minimize2, Play, RefreshCw, Square, Video, VolumeX, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { errorText } from "../shared/api";
import { formatBytes } from "../shared/format";
import { useLang } from "../shared/i18n";
import {
  idleRecording, isRecordingActive, nativeRecordingAvailable, recordingApi, recordingDuration,
  type RecordingSources, type RecordingStatus,
} from "./api";
import { recordingTexts } from "./translations";
import "./styles.css";

/** Mounted once in the main window, so navigation never loses the Stop control. */
export function RecordingPanel() {
  const text = recordingTexts[useLang()];
  const id = useId();
  const desktop = nativeRecordingAvailable();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>(idleRecording);
  const [sources, setSources] = useState<RecordingSources | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [fps, setFps] = useState<30 | 60>(30);
  const [cursor, setCursor] = useState(true);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(desktop);
  const [busy, setBusy] = useState(false);
  const [configure, setConfigure] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const revision = useRef(0);
  const sourceRevision = useRef(0);
  const statusRef = useRef(status);
  const statusRequest = useRef<{ revision: number; promise: Promise<RecordingStatus> } | null>(null);
  const active = isRecordingActive(status.phase);

  const acceptStatus = useCallback((next: RecordingStatus) => {
    if (!mounted.current) return;
    if (isRecordingActive(statusRef.current.phase) && !isRecordingActive(next.phase)) setOpen(true);
    statusRef.current = next;
    setStatus(next);
  }, []);

  // One check restores a recording after a webview reload. Further requests only
  // run while the controls are open or a recording is active, never concurrently.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; sourceRevision.current++; };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const version = revision.current;
      if (!mutating.current) {
        // Effect restarts (opening/closing controls) share an outstanding read.
        // Its original revision remains attached if a command ran meanwhile.
        const request = statusRequest.current ?? { revision: version, promise: recordingApi.status() };
        statusRequest.current = request;
        try {
          const next = await request.promise;
          if (!cancelled && mounted.current && request.revision === revision.current && version === revision.current && !mutating.current) {
            acceptStatus(next);
            setChecking(false);
          }
        } catch (error) {
          if (!cancelled && mounted.current && request.revision === revision.current && version === revision.current) {
            setChecking(false);
            setNotice(errorText(error));
          }
        } finally {
          if (statusRequest.current === request) statusRequest.current = null;
        }
      }
      if (!cancelled && (open || isRecordingActive(statusRef.current.phase))) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [desktop, open, active, acceptStatus]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const loadSources = useCallback(async () => {
    if (!desktop) return;
    const version = ++sourceRevision.current;
    setLoading(true);
    setNotice(null);
    try {
      const next = await recordingApi.sources();
      if (!mounted.current || version !== sourceRevision.current) return;
      setSources(next);
      setSourceId((current) => next.sources.some((source) => source.id === current) ? current : (next.sources[0]?.id ?? ""));
    } catch (error) {
      if (mounted.current && version === sourceRevision.current) setNotice(errorText(error));
    } finally {
      if (mounted.current && version === sourceRevision.current) setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    if (open && !isRecordingActive(statusRef.current.phase)) void loadSources();
  }, [open, loadSources]);

  // The ref locks synchronously before React renders, preventing double-starts.
  // A revision also prevents an older poll from replacing the command response.
  const run = async (action: () => Promise<RecordingStatus | void>) => {
    if (mutating.current) return;
    mutating.current = true;
    revision.current++;
    setBusy(true);
    setNotice(null);
    try {
      const next = await action();
      if (next) acceptStatus(next);
    } catch (error) {
      if (mounted.current) setNotice(errorText(error));
    } finally {
      revision.current++;
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const canStart = desktop && !checking && sources?.supported && sources.sources.some((source) => source.id === sourceId) && !loading && !busy && !active;
  const selected = sources?.sources.find((source) => source.id === sourceId);
  const finished = status.phase === "completed" || status.phase === "failed";
  const savedFile = finished && !!status.path && status.bytes > 0;
  const phaseLabel = status.phase === "idle" ? text.idle : text[status.phase];

  return (
    <>
      <div className="rec-launcher">
        <button type="button" className="btn rec-launcher-open" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={active ? text.reopen : text.launch}>
          {active ? <><span className="rec-dot" aria-hidden="true" /><span className="rec-time">{recordingDuration(status.elapsedMs)}</span></> : <><Video size={16} aria-hidden="true" />{text.launch}</>}
        </button>
        {active && (
          <button type="button" className="btn rec-stop" disabled={busy || status.phase === "stopping"} onClick={() => { setOpen(true); void run(recordingApi.stop); }}>
            <Square size={12} fill="currentColor" aria-hidden="true" />{status.phase === "stopping" ? text.stopping : text.stop}
          </button>
        )}
      </div>

      <dialog ref={dialog} className="rec-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={(event) => event.stopPropagation()} onPaste={(event) => event.stopPropagation()} onCancel={() => setOpen(false)} onClose={() => { if (!dialog.current?.open) setOpen(false); }}>
        <header className="rec-header">
          <div>
            <h2 id={`${id}-title`} className="display">{text.title}</h2>
            <p id={`${id}-description`} className="rec-description">{text.description}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={text.close} title={text.close} onClick={() => setOpen(false)}><X size={18} /></button>
        </header>

        {active || (finished && !configure) ? (
          <div className="rec-progress">
            <div className={`rec-status rec-status-${status.phase}`} role="status">
              {status.phase === "completed" ? <Check size={17} aria-hidden="true" /> : status.phase === "failed" ? <AlertCircle size={17} aria-hidden="true" /> : status.phase === "recording" ? <span className="rec-dot" aria-hidden="true" /> : <LoaderCircle size={17} aria-hidden="true" />}
              {phaseLabel}
            </div>
            <dl className="rec-stats">
              <div><dt>{text.elapsed}</dt><dd>{recordingDuration(status.elapsedMs)}</dd></div>
              <div><dt>{text.size}</dt><dd>{formatBytes(status.bytes)}</dd></div>
              <div className="rec-frame-count">{text.frames}: {status.frames.toLocaleString()}</div>
            </dl>
            {!!status.width && !!status.height && <p className="rec-quality">{status.width} × {status.height}{status.fps ? ` · ${status.fps} fps` : ""} · H.264 · MP4</p>}
            {!!status.droppedFrames && <p className="rec-help">{text.skipped}</p>}
            {status.error && <p className="rec-error" role="alert">{status.error}</p>}
            {notice && <p className="rec-error" role="alert">{notice}</p>}
            {savedFile && <div className="rec-path"><strong>{text.path}</strong><span>{status.path}</span></div>}
            {active && <><p className="rec-help">{text.keepRunning}</p><p className="rec-help">{text.stopShortcut}: <kbd className="kbd">Ctrl + Shift + F9</kbd></p></>}
            <div className="rec-actions">
              {active ? <><button type="button" className="btn" disabled={busy} onClick={() => void run(() => getCurrentWindow().minimize())}><Minimize2 size={14} aria-hidden="true" />{text.minimize}</button><button type="button" className="btn rec-stop" disabled={busy || status.phase === "stopping"} onClick={() => void run(recordingApi.stop)}><Square size={12} fill="currentColor" aria-hidden="true" />{status.phase === "stopping" ? text.stopping : text.stop}</button></> : <>
                {savedFile && <button type="button" className="btn" disabled={busy} onClick={() => void run(recordingApi.reveal)}><FolderOpen size={15} aria-hidden="true" />{text.reveal}</button>}
                {savedFile && status.phase === "completed" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(recordingApi.open)}><Play size={14} aria-hidden="true" />{text.openVideo}</button>}
                <button type="button" className="btn" disabled={busy} onClick={() => { setConfigure(true); void loadSources(); }}>{text.launch}</button>
              </>}
            </div>
          </div>
        ) : (
          <form className="rec-form" onSubmit={(event) => { event.preventDefault(); if (canStart) void run(async () => { const next = await recordingApi.start({ sourceId, fps, cursor }); if (mounted.current) setConfigure(false); return next; }); }}>
            {!desktop || (sources && !sources.supported) ? <div className="rec-empty"><p className="rec-help">{!desktop ? text.browser : sources?.reason ?? text.unavailable}</p></div> : <>
              <div className="rec-field">
                <label className="rec-field-title" htmlFor={`${id}-source`}>{text.source}</label>
                <div className="rec-select-row">
                  <select id={`${id}-source`} className="rec-select" value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={loading || busy || !sources?.sources.length}>
                    {!sources?.sources.length && <option value="">{loading ? text.loading : text.chooseSource}</option>}
                    {(["monitor", "window"] as const).map((kind) => <optgroup key={kind} label={kind === "monitor" ? text.displays : text.windows}>{sources?.sources.filter((source) => source.kind === kind).map((source) => <option key={source.id} value={source.id}>{source.name}{source.width > 0 && source.height > 0 ? ` · ${source.width} × ${source.height}` : ""}</option>)}</optgroup>)}
                  </select>
                  <button type="button" className="btn" onClick={() => void loadSources()} disabled={loading || busy} aria-label={text.refresh} title={text.refresh}><RefreshCw size={15} aria-hidden="true" /></button>
                </div>
                {sources?.supported && !sources.sources.length && <p className="rec-help">{text.noSources}</p>}
                {selected?.kind === "monitor" && <p className="rec-help">{text.captureWarning}</p>}
              </div>
              <div className="rec-field">
                <label className="rec-field-title" htmlFor={`${id}-fps`}>{text.frameRate}</label>
                <select id={`${id}-fps`} className="rec-select" value={fps} onChange={(event) => setFps(event.target.value === "60" ? 60 : 30)} disabled={busy}><option value="30">{text.thirty}</option><option value="60">{text.sixty}</option></select>
                <p className="rec-quality">{text.quality}</p>
                <p className="rec-help">{text.qualityHint}</p>
              </div>
              <label className="rec-check"><input type="checkbox" checked={cursor} onChange={(event) => setCursor(event.target.checked)} disabled={busy} />{text.cursor}</label>
              <div className="rec-audio"><VolumeX size={17} aria-hidden="true" /><div><strong>{text.silent}</strong><p className="rec-help">{text.silentHint}</p></div></div>
              <p className="rec-help">{text.stopShortcut}: <kbd className="kbd">Ctrl + Shift + F9</kbd></p>
            </>}
            {notice && <p className="rec-error" role="alert">{notice}</p>}
            {desktop && <div className="rec-actions"><button type="submit" className="btn btn-primary" disabled={!canStart}><Circle size={13} fill="currentColor" aria-hidden="true" />{busy ? text.starting : checking ? text.checking : text.start}</button></div>}
          </form>
        )}
      </dialog>
    </>
  );
}

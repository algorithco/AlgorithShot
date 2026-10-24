// The quick card shown in the screen corner after a capture. It lays itself
// out, reports its size so Rust can place and show the window, and hides
// itself after a few seconds unless the pointer is on it.

import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, Download, ExternalLink, FolderOpen, Pin, Save, Send, ShieldAlert, Trash2, PenLine, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorText, shotUrl, thumbUrl, type CardPayload, type Shot } from "../shared/api";
import { formatBytes } from "../shared/format";
import { useT } from "../shared/i18n";
import { initSettings, useSettings } from "../shared/settings";
import { useTheme } from "../shared/theme";

const MARGIN = 14; // room for the shadow around the card

export function Card() {
  useTheme();
  const t = useT();
  const seconds = useSettings((s) => s.settings?.cardSeconds ?? 6);
  const [card, setCard] = useState<CardPayload | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const hovering = useRef(false);

  const hideNow = useCallback(() => {
    window.clearTimeout(timer.current);
    hovering.current = false;
    // Hiding must not wait for animation frames, which can be throttled when
    // the card is unfocused. Remove the native input surface immediately.
    api.cardHide().catch((e) => console.error(errorText(e)));
    setCard(null);
    setShot(null);
    setNote(null);
  }, []);

  const arm = useCallback(
    (ms: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!hovering.current) hideNow();
      }, ms);
    },
    [hideNow],
  );

  useEffect(() => {
    initSettings();
    const subs = [
      listen<CardPayload>("card:show", (e) => {
        setNote(null);
        setCard(e.payload);
        setShot(e.payload.kind === "shot" ? e.payload.shot : null);
        if (e.payload.kind === "countdown") setCount(e.payload.seconds);
      }),
      listen("card:reset", () => {
        window.clearTimeout(timer.current);
        hovering.current = false;
        setCard(null);
        setShot(null);
        setNote(null);
      }),
      // The privacy check finishes after the card appears; refresh the count.
      listen<string>("library:indexed", (e) => {
        setShot((current) => {
          if (current && current.id === e.payload) {
            api.get(current.id).then((d) => setShot(d.shot)).catch(() => {});
          }
          return current;
        });
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  // Countdown ticks.
  useEffect(() => {
    if (card?.kind !== "countdown" || count <= 0) return;
    const id = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [card, count]);

  // Measure, then let Rust size and show the window.
  useLayoutEffect(() => {
    if (!card || !boxRef.current) return;
    const { offsetWidth, offsetHeight } = boxRef.current;
    api.cardReady(offsetWidth + MARGIN * 2, offsetHeight + MARGIN * 2);
    if (card.kind !== "countdown") arm(seconds * 1000);
  }, [card, note, shot?.privacy, seconds, arm]);

  const act = (fn: () => Promise<unknown>, after?: string) => {
    fn()
      .then(() => {
        if (after) {
          setNote(after);
          arm(3500);
        } else hideNow();
      })
      .catch((e) => setNote(t("common.error", { msg: errorText(e) })));
  };

  if (!card) return null;

  return (
    <div
      className="card-wrap"
      style={{ padding: MARGIN }}
      onMouseEnter={() => {
        hovering.current = true;
        window.clearTimeout(timer.current);
      }}
      onMouseLeave={() => {
        hovering.current = false;
        if (card.kind !== "countdown") arm(2500);
      }}
    >
      <div ref={boxRef} className={`card ${card.kind === "message" && card.error ? "is-error" : ""}`}>
        <button className="card-close" aria-label={t("common.close")} onClick={hideNow}>
          <X size={15} />
        </button>
        {card.kind === "shot" && (
          <ShotCard
            card={card}
            shot={shot}
            note={note}
            act={act}
            hide={hideNow}
            hold={(on) => {
              hovering.current = on;
              if (!on) arm(4000);
            }}
          />
        )}
        {card.kind === "text" && (
          <>
            <div className="card-title">
              <Check size={16} className="ok" /> {card.text ? t("card.textCopied") : t("card.noText")}
            </div>
            {card.text && <pre className="card-text">{card.text}</pre>}
            {card.text && (
              <div className="card-row">
                <button className="btn" onClick={() => act(() => api.copyText(card.text), t("common.copied"))}>
                  <Copy size={15} /> {t("common.copy")}
                </button>
              </div>
            )}
          </>
        )}
        {card.kind === "qr" && (
          <>
            <div className="card-title">{card.items.length ? t("card.qrFound", { n: card.items.length }) : t("card.noQr")}</div>
            {card.items.map((item) => (
              <div key={item} className="card-qr">
                <span className="card-qr-text">{item}</span>
                {/^https?:\/\//i.test(item) && (
                  <button className="btn" onClick={() => act(() => openUrl(item))}>
                    <ExternalLink size={15} /> {t("card.openLink")}
                  </button>
                )}
                <button className="icon-btn" title={t("common.copy")} onClick={() => act(() => api.copyText(item), t("common.copied"))}>
                  <Copy size={15} />
                </button>
              </div>
            ))}
          </>
        )}
        {card.kind === "color" && (
          <div className="card-color">
            <span className="swatch" style={{ background: card.hex }} />
            <div>
              <div className="card-title">{t("card.colorCopied")}</div>
              <div className="measure big">{card.hex}</div>
            </div>
          </div>
        )}
        {card.kind === "countdown" && (
          <div className="card-countdown">
            <span>{t("card.countdown")}</span>
            <span className="measure count">{Math.max(count, 0)}</span>
          </div>
        )}
        {card.kind === "saved" && (
          <>
            <div className="card-title">
              <Check size={16} className="ok" /> {t("card.savedTo")}
            </div>
            <div className="card-path">{card.path}</div>
            <div className="card-row">
              <button className="btn" onClick={() => act(() => api.revealPath(card.path))}>
                <FolderOpen size={15} /> {t("card.folder")}
              </button>
            </div>
          </>
        )}
        {card.kind === "message" && <div className="card-title">{card.text}</div>}
      </div>
    </div>
  );
}

function ShotCard({
  card,
  shot,
  note,
  act,
  hide,
  hold,
}: {
  card: Extract<CardPayload, { kind: "shot" }>;
  shot: Shot | null;
  note: string | null;
  act: (fn: () => Promise<unknown>, after?: string) => void;
  hide: () => void;
  /** Keeps the card up while a dialog it opened is showing. */
  hold: (on: boolean) => void;
}) {
  const t = useT();
  const temp = card.tempId;
  const src = shot ? thumbUrl(shot) : shotUrl(`mem/${temp}`);
  const target = shot ? `shot:${shot.id}` : `temp:${temp}`;
  const title = card.copied ? t("card.copied") : shot ? t("card.saved") : t("card.notSaved");
  const meta = [`${card.width} × ${card.height}`, shot ? formatBytes(shot.bytes) : null, shot?.app || null].filter(Boolean).join(" · ");

  // Dragging the thumbnail out drops the file into chats, mail or folders.
  const press = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const drag = async () => {
    dragged.current = true;
    try {
      const file = shot ? shot.path : await api.tempFile(temp!);
      const icon = await api.dragIcon(shot?.id ?? null, shot ? null : temp);
      await startDrag({ item: [file], icon });
      hide();
    } catch (err) {
      console.error(errorText(err));
    }
  };

  return (
    <>
      <div className="card-main">
        <button
          className="card-thumb checker brackets"
          title={t("common.edit")}
          onPointerDown={(e) => {
            dragged.current = false;
            if (e.button === 0) press.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            const p = press.current;
            if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) {
              press.current = null;
              drag();
            }
          }}
          onPointerUp={() => (press.current = null)}
          onClick={() => {
            if (!dragged.current) act(() => api.openEditor(target));
          }}
        >
          <img src={src} alt="" draggable={false} />
        </button>
        <div className="card-info">
          <div className="card-title">
            <Check size={16} className="ok" /> {title}
          </div>
          <div className="edge">{meta}</div>
          {note && <div className="card-note">{note}</div>}
        </div>
      </div>
      {shot && shot.privacy > 0 && (
        <button className="card-privacy" onClick={() => act(() => api.openEditor(target, "privacy"))}>
          <ShieldAlert size={16} />
          <span>{t("card.privacy", { n: shot.privacy })}</span>
          <strong>{t("card.hide")}</strong>
        </button>
      )}
      <div className="card-row">
        <button className="icon-btn" title={t("common.edit")} onClick={() => act(() => api.openEditor(target))}>
          <PenLine size={16} />
        </button>
        <button className="icon-btn" title={t("common.pin")} onClick={() => act(() => (shot ? api.pin(shot.id) : api.tempPin(temp!)))}>
          <Pin size={16} />
        </button>
        <button
          className="icon-btn"
          title={t("card.telegram")}
          onClick={() => act(() => api.shareTelegram(shot?.id ?? null, shot ? null : temp), t("card.telegramPaste"))}
        >
          <Send size={16} />
        </button>
        <button
          className="icon-btn"
          title={t("common.copy")}
          onClick={() => act(() => (shot ? api.copy([shot.id]) : api.tempCopy(temp!)), t("common.copied"))}
        >
          <Copy size={16} />
        </button>
        <button
          className="icon-btn"
          title={t("card.saveAs")}
          onClick={() => {
            // Rust shows the "Saved" card itself, or nothing if the dialog is cancelled.
            hold(true);
            api.saveAsImage(shot?.id ?? null, shot ? null : temp).catch(() => {}).finally(() => hold(false));
          }}
        >
          <Download size={16} />
        </button>
        {shot ? (
          <button className="icon-btn" title={t("card.folder")} onClick={() => act(() => api.reveal(shot.id))}>
            <FolderOpen size={16} />
          </button>
        ) : (
          <button className="icon-btn" title={t("card.save")} onClick={() => act(() => api.tempSave(temp!), t("card.saved"))}>
            <Save size={16} />
          </button>
        )}
        <span style={{ flex: 1 }} />
        {shot && (
          <button className="icon-btn danger" title={t("common.delete")} onClick={() => act(() => api.remove([shot.id], false))}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </>
  );
}

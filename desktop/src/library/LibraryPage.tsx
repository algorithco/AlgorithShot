// The library: search, a day-grouped grid of screenshots, selection,
// details for the selected one, and delete with undo.

import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import {
  Copy,
  Files,
  FolderOpen,
  ImageOff,
  PenLine,
  Pin,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, editorApi, errorText, imageUrl, thumbUrl, type Shot, type ShotDetail } from "../shared/api";
import { dayKey, formatBytes, formatDate, formatDateTime, prettyKey } from "../shared/format";
import { useLang, useT } from "../shared/i18n";
import { useSettings } from "../shared/settings";
import { Dialog, toast } from "../shared/ui";
import { useLibrary } from "./store";

const GAP = 14;
const PAD = 20;
const MIN_TILE = 210;
const CAPTION = 46;

type Row = { kind: "header"; key: string; label: string; count: number } | { kind: "tiles"; key: string; items: Shot[] };

export function LibraryPage() {
  const t = useT();
  const settings = useSettings((s) => s.settings);
  const lib = useLibrary();
  const [searchText, setSearchText] = useState(lib.search);
  const [menu, setMenu] = useState<{ x: number; y: number; shot: Shot } | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<Shot | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load, and reload whenever Rust says the library changed.
  useEffect(() => {
    lib.refresh().catch((e) => toast({ text: t("common.error", { msg: errorText(e) }), error: true }));
    let timer = 0;
    const sub = listen("library:changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => useLibrary.getState().refresh().catch(() => {}), 200);
    });
    return () => {
      window.clearTimeout(timer);
      sub.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any picture can be edited: paste one, or drop image files on the window.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).matches?.("input, textarea")) return;
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      editorApi.openBytes(new Uint8Array(await file.arrayBuffer())).catch((err) => toast({ text: t("common.error", { msg: errorText(err) }), error: true }));
    };
    window.addEventListener("paste", onPaste);
    const drop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      for (const path of e.payload.paths.filter((p) => /\.(png|jpe?g|webp|bmp|gif)$/i.test(p)).slice(0, 5)) {
        editorApi.openFile(path).catch((err) => toast({ text: t("common.error", { msg: errorText(err) }), error: true }));
      }
    });
    return () => {
      window.removeEventListener("paste", onPaste);
      drop.then((un) => un()).catch(() => {});
    };
  }, [t]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (searchText === lib.search) return;
    const id = window.setTimeout(() => lib.setQuery({ search: searchText }), 180);
    return () => window.clearTimeout(id);
  }, [searchText, lib]);

  const selectedShots = useMemo(() => lib.items.filter((s) => lib.selected.has(s.id)), [lib.items, lib.selected]);

  const remove = useCallback(
    async (ids: string[], permanent: boolean) => {
      try {
        const res = await api.remove(ids, permanent);
        useLibrary.getState().clearSelection();
        if (res.canUndo) {
          toast(
            {
              text: t("lib.movedToBin", { n: res.deleted }),
              action: {
                label: t("common.undo"),
                run: () => api.undoDelete().then((n) => toast({ text: t("lib.restored", { n }) }, 2500)),
              },
            },
            7000,
          );
        }
      } catch (e) {
        toast({ text: t("common.error", { msg: errorText(e) }), error: true });
      }
    },
    [t],
  );

  const run = useCallback(
    (fn: () => Promise<unknown>, done?: string) => {
      setMenu(null);
      fn()
        .then(() => done && toast({ text: done }, 2000))
        .catch((e) => toast({ text: t("common.error", { msg: errorText(e) }), error: true }));
    },
    [t],
  );

  // Keyboard shortcuts for the grid.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      const primaryModifier = e.ctrlKey || e.metaKey;
      const state = useLibrary.getState();
      const ids = [...state.selected];
      if ((primaryModifier && e.key.toLowerCase() === "f") || (!typing && e.key === "/")) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (typing || confirmIds || renaming) return;
      if (e.key === "Delete" && ids.length) {
        e.preventDefault();
        if (e.shiftKey) setConfirmIds(ids);
        else remove(ids, false);
      } else if (primaryModifier && e.key.toLowerCase() === "a") {
        e.preventDefault();
        state.selectAll();
      } else if (primaryModifier && e.key.toLowerCase() === "c" && ids.length) {
        e.preventDefault();
        run(() => api.copy(ids, ids.length > 1), t("common.copied"));
      } else if (e.key === "Enter" && ids.length === 1) {
        api.openEditor(`shot:${ids[0]}`);
      } else if (e.key === "F2" && ids.length === 1) {
        const shot = state.items.find((s) => s.id === ids[0]);
        if (shot) setRenaming(shot);
      } else if (e.key === "Escape") {
        setMenu(null);
        state.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmIds, renaming, remove, run, t]);

  const hotkey = settings?.hotkeys.capture || settings?.hotkeys.captureAlt || "Ctrl+Alt+A";
  const empty = !lib.loading && lib.items.length === 0;

  return (
    <div className="library" onClick={() => setMenu(null)}>
      <header className="lib-top">
        <div className="search">
          <Search size={16} />
          <input
            ref={searchRef}
            className="search-input"
            placeholder={t("lib.search")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchText("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
          />
          {searchText && (
            <button className="icon-btn" onClick={() => setSearchText("")} aria-label={t("common.close")}>
              <X size={15} />
            </button>
          )}
        </div>
        <span className="edge lib-total">{lib.total > 0 ? lib.total : ""}</span>
      </header>

      <div className="lib-body">
        {empty ? (
          <EmptyState search={lib.search} hotkey={hotkey} />
        ) : (
          <Grid
            onMenu={(shot, x, y) => {
              if (!lib.selected.has(shot.id)) lib.select(shot.id, "only");
              setMenu({ shot, x, y });
            }}
          />
        )}
        {selectedShots.length === 1 && <Details shot={selectedShots[0]} onRename={setRenaming} onDelete={(ids) => remove(ids, false)} />}
      </div>

      {selectedShots.length > 1 && (
        <div className="selection-bar">
          <span className="display">{t("lib.selected", { n: selectedShots.length })}</span>
          <span className="edge">{formatBytes(selectedShots.reduce((a, s) => a + s.bytes, 0))}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => run(() => api.copy(selectedShots.map((s) => s.id), true), t("common.copied"))}>
            <Files size={15} /> {t("lib.copyFiles")}
          </button>
          <button className="btn btn-danger" onClick={() => remove(selectedShots.map((s) => s.id), false)}>
            <Trash2 size={15} /> {t("common.delete")}
          </button>
          <button className="btn btn-ghost" onClick={() => lib.clearSelection()}>
            {t("lib.clearSelection")}
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { icon: PenLine, label: t("lib.openEditor"), run: () => run(() => api.openEditor(`shot:${menu.shot.id}`)) },
            { icon: Pin, label: t("common.pin"), run: () => run(() => api.pin(menu.shot.id)) },
            { icon: Copy, label: t("common.copy"), run: () => run(() => api.copy([menu.shot.id]), t("common.copied")) },
            { icon: Files, label: t("lib.copyFile"), run: () => run(() => api.copy([menu.shot.id], true), t("common.copied")) },
            { icon: Send, label: t("card.telegram"), run: () => run(() => api.shareTelegram(menu.shot.id), t("card.telegramPaste")) },
            { icon: Star, label: menu.shot.favorite ? t("lib.unstar") : t("lib.star"), run: () => run(() => api.favorite(menu.shot.id, !menu.shot.favorite)) },
            {
              icon: PenLine,
              label: t("common.rename"),
              run: () => {
                setMenu(null);
                setRenaming(menu.shot);
              },
            },
            { icon: FolderOpen, label: t("lib.showInFolder"), run: () => run(() => api.reveal(menu.shot.id)) },
            "sep",
            {
              icon: Trash2,
              label: t("common.delete"),
              danger: true,
              run: () => {
                setMenu(null);
                remove([...lib.selected], false);
              },
            },
            {
              icon: Trash2,
              label: t("lib.deleteForever.confirm"),
              danger: true,
              run: () => {
                setMenu(null);
                setConfirmIds([...lib.selected]);
              },
            },
          ]}
        />
      )}

      {confirmIds && (
        <Dialog
          title={t("lib.deleteForever.title")}
          onCancel={() => setConfirmIds(null)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmIds(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-danger-solid"
                onClick={() => {
                  const ids = confirmIds;
                  setConfirmIds(null);
                  remove(ids, true);
                }}
              >
                {t("lib.deleteForever.confirm")}
              </button>
            </>
          }
        >
          <p>{t("lib.deleteForever.body", { n: confirmIds.length })}</p>
        </Dialog>
      )}

      {renaming && <RenameDialog shot={renaming} onClose={() => setRenaming(null)} />}
    </div>
  );

  function EmptyState({ search, hotkey }: { search: string; hotkey: string }) {
    if (search) {
      return (
        <div className="empty">
          <Search size={34} strokeWidth={1.5} />
          <h2 className="display">{t("lib.noResults", { q: search })}</h2>
        </div>
      );
    }
    return (
      <div className="empty">
        <div className="empty-frame brackets">
          <ImageOff size={30} strokeWidth={1.5} />
        </div>
        <h2 className="display">{t("lib.empty.title")}</h2>
        <p>{t("lib.empty.body", { key: prettyKey(hotkey) })}</p>
        <button className="btn btn-primary" onClick={() => api.captureStart("region")}>
          {t("lib.capture")}
        </button>
      </div>
    );
  }
}

/** The virtualised grid: day headers and rows of tiles. */
function Grid({ onMenu }: { onMenu: (shot: Shot, x: number, y: number) => void }) {
  const t = useT();
  const lang = useLang();
  const { items, selected, select, loadMore, total } = useLibrary();
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (MIN_TILE + GAP)));
  const tileW = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const thumbH = Math.round(tileW * 0.62);
  const rowH = thumbH + CAPTION + GAP;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let i = 0;
    while (i < items.length) {
      const key = dayKey(items[i].created);
      let j = i;
      while (j < items.length && dayKey(items[j].created) === key) j++;
      const label = key === "today" ? t("lib.today") : key === "yesterday" ? t("lib.yesterday") : formatDate(items[i].created, lang);
      out.push({ kind: "header", key: `h-${key}`, label, count: j - i });
      for (let k = i; k < j; k += cols) out.push({ kind: "tiles", key: `r-${items[k].id}`, items: items.slice(k, Math.min(k + cols, j)) });
      i = j;
    }
    return out;
  }, [items, cols, t, lang]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 44 : rowH),
    overscan: 4,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowH, cols, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const last = virtualRows[virtualRows.length - 1];
  useEffect(() => {
    if (last && last.index >= rows.length - 6 && items.length < total) loadMore();
  }, [last, rows.length, items.length, total, loadMore]);

  return (
    <div className="grid-scroll" ref={parentRef} onClick={(e) => e.target === e.currentTarget && useLibrary.getState().clearSelection()}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualRows.map((v) => {
          const row = rows[v.index];
          return (
            <div key={row.key} className={row.kind === "header" ? "day-row" : "tile-row"} style={{ transform: `translateY(${v.start}px)`, height: v.size, gap: GAP }}>
              {row.kind === "header" ? (
                <>
                  <span className="display day-label">{row.label}</span>
                  <span className="day-line" />
                  <span className="edge">{row.count}</span>
                </>
              ) : (
                row.items.map((s) => (
                  <Tile
                    key={s.id}
                    shot={s}
                    width={tileW}
                    thumbH={thumbH}
                    selected={selected.has(s.id)}
                    onClick={(e) => select(s.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "only")}
                    onMenu={(x, y) => onMenu(s, x, y)}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({
  shot,
  width,
  thumbH,
  selected,
  onClick,
  onMenu,
}: {
  shot: Shot;
  width: number;
  thumbH: number;
  selected: boolean;
  onClick: (e: ReactMouseEvent) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const t = useT();
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`tile${selected ? " selected" : ""}`}
      style={{ width }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={() => api.openEditor(`shot:${shot.id}`)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(e.clientX, e.clientY);
      }}
      title={shot.title || shot.name}
    >
      <div className={`tile-thumb checker${selected ? " brackets" : ""}`} style={{ height: thumbH }}>
        {broken ? <ImageOff size={26} strokeWidth={1.5} className="tile-broken" /> : <img src={thumbUrl(shot)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />}
        {shot.favorite && <Star size={15} className="tile-star" fill="currentColor" />}
        {shot.privacy > 0 && (
          <span className="tile-badge" title={t("lib.privacyFound", { n: shot.privacy })}>
            <ShieldAlert size={13} />
          </span>
        )}
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
          <TileButton icon={Star} label={shot.favorite ? t("lib.unstar") : t("lib.star")} on={shot.favorite} onClick={() => api.favorite(shot.id, !shot.favorite)} />
          <TileButton icon={Copy} label={t("common.copy")} onClick={() => api.copy([shot.id]).then(() => toast({ text: t("common.copied") }, 1800))} />
          <TileButton icon={PenLine} label={t("common.edit")} onClick={() => api.openEditor(`shot:${shot.id}`)} />
        </div>
      </div>
      <div className="tile-cap">
        <div className="tile-name">{shot.name}</div>
        <div className="edge">
          {shot.width} × {shot.height} · {formatBytes(shot.bytes)}
          {shot.app ? ` · ${shot.app}` : ""}
        </div>
      </div>
    </div>
  );
}

function TileButton({ icon: Icon, label, on, onClick }: { icon: LucideIcon; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button className={`tile-btn${on ? " on" : ""}`} title={label} aria-label={label} onClick={onClick}>
      <Icon size={15} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** The panel for one selected screenshot. */
function Details({ shot, onRename, onDelete }: { shot: Shot; onRename: (s: Shot) => void; onDelete: (ids: string[]) => void }) {
  const t = useT();
  const lang = useLang();
  const [detail, setDetail] = useState<ShotDetail | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get(shot.id)
        .then((d) => alive && setDetail(d))
        .catch(() => alive && setDetail(null));
    load();
    const sub = listen<string>("library:indexed", (e) => e.payload === shot.id && load());
    return () => {
      alive = false;
      sub.then((un) => un());
    };
  }, [shot.id, shot.rev]);

  const act = (fn: () => Promise<unknown>, done?: string) =>
    fn()
      .then(() => done && toast({ text: done }, 2000))
      .catch((e) => toast({ text: t("common.error", { msg: errorText(e) }), error: true }));

  const text = detail?.text ?? "";
  return (
    <aside className="details">
      <div className="details-preview checker" onDoubleClick={() => api.openEditor(`shot:${shot.id}`)}>
        <img src={imageUrl(shot)} alt="" draggable={false} />
      </div>
      <button className="details-name" title={t("common.rename")} onClick={() => onRename(shot)}>
        {shot.name}
      </button>
      <div className="details-actions">
        <button className="btn btn-primary" onClick={() => api.openEditor(`shot:${shot.id}`)}>
          <PenLine size={15} /> {t("common.edit")}
        </button>
        <button className="icon-btn" title={t("common.copy")} onClick={() => act(() => api.copy([shot.id]), t("common.copied"))}>
          <Copy size={16} />
        </button>
        <button className="icon-btn" title={t("common.pin")} onClick={() => act(() => api.pin(shot.id))}>
          <Pin size={16} />
        </button>
        <button className="icon-btn" title={t("card.telegram")} onClick={() => act(() => api.shareTelegram(shot.id), t("card.telegramPaste"))}>
          <Send size={16} />
        </button>
        <button className="icon-btn" title={t("lib.showInFolder")} onClick={() => act(() => api.reveal(shot.id))}>
          <FolderOpen size={16} />
        </button>
        <button className="icon-btn danger" title={t("common.delete")} onClick={() => onDelete([shot.id])}>
          <Trash2 size={16} />
        </button>
      </div>

      <dl className="details-meta">
        <dt>{t("lib.size")}</dt>
        <dd className="measure">
          {shot.width} × {shot.height} px · {formatBytes(shot.bytes)}
        </dd>
        <dt>{t("lib.created")}</dt>
        <dd>{formatDateTime(shot.created, lang)}</dd>
        {(shot.app || shot.title) && (
          <>
            <dt>{t("lib.from")}</dt>
            <dd>
              {shot.app}
              {shot.title && <div className="details-sub">{shot.title}</div>}
              {shot.url && <div className="details-sub">{shot.url}</div>}
            </dd>
          </>
        )}
        {shot.edited && (
          <>
            <dt>{t("lib.file")}</dt>
            <dd>{t("lib.edited")}</dd>
          </>
        )}
      </dl>

      {shot.privacy > 0 && (
        <button className="details-privacy" onClick={() => api.openEditor(`shot:${shot.id}`, "privacy")}>
          <ShieldAlert size={16} />
          <span>{t("lib.privacyFound", { n: shot.privacy })}</span>
          <strong>{t("card.hide")}</strong>
        </button>
      )}

      <div className="details-text">
        <div className="details-text-head">
          <span className="edge">{t("lib.textInside")}</span>
          {text && (
            <button className="btn btn-ghost" onClick={() => act(() => api.copyText(text), t("common.copied"))}>
              <Copy size={14} /> {t("lib.copyText")}
            </button>
          )}
        </div>
        <div className="details-text-body">{shot.textState === 0 ? t("lib.textPending") : text || t("lib.textNone")}</div>
      </div>
    </aside>
  );
}

type MenuItem = { icon: LucideIcon; label: string; danger?: boolean; run: () => void } | "sep";

function ContextMenu({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ x: Math.min(x, window.innerWidth - el.offsetWidth - 8), y: Math.min(y, window.innerHeight - el.offsetHeight - 8) });
  }, [x, y]);
  return (
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()} role="menu">
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button key={i} role="menuitem" className={item.danger ? "danger" : ""} onClick={item.run}>
            <item.icon size={15} />
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

function RenameDialog({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const t = useT();
  const dot = shot.name.lastIndexOf(".");
  const [name, setName] = useState(dot > 0 ? shot.name.slice(0, dot) : shot.name);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.rename(shot.id, name.trim());
      onClose();
    } catch (e) {
      const msg = errorText(e);
      setError(msg.includes("name_taken") ? t("lib.nameTaken") : t("common.error", { msg }));
    }
  };
  return (
    <Dialog
      title={t("common.rename")}
      typed
      onCancel={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <input
        className="input"
        style={{ width: "100%", marginBottom: error ? 6 : 16 }}
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
        onFocus={(e) => e.target.select()}
      />
      {error && <p style={{ color: "var(--danger)", margin: "0 0 12px" }}>{error}</p>}
    </Dialog>
  );
}

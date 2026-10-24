// Clean up: duplicates, old and large screenshots, deleted in one go.

import { Check, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText, thumbUrl, type Cleanup, type Shot } from "../shared/api";
import { formatBytes, formatDate } from "../shared/format";
import { useLang, useT } from "../shared/i18n";
import { toast } from "../shared/ui";

export function CleanupPage() {
  const t = useT();
  const [data, setData] = useState<Cleanup | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const scan = useCallback(async () => {
    try {
      const d = await api.cleanupScan();
      setData(d);
      // In each group of look-alikes keep the newest (the last one) unticked.
      setPicked(new Set(d.duplicates.flatMap((g) => g.slice(0, -1).map((s) => s.id))));
    } catch (e) {
      toast({ text: t("common.error", { msg: errorText(e) }), error: true });
    }
  }, [t]);

  useEffect(() => {
    scan();
  }, [scan]);

  const all = useMemo(() => {
    const map = new Map<string, Shot>();
    data?.duplicates.flat().forEach((s) => map.set(s.id, s));
    data?.old.forEach((s) => map.set(s.id, s));
    data?.large.forEach((s) => map.set(s.id, s));
    return map;
  }, [data]);

  const bytes = [...picked].reduce((sum, id) => sum + (all.get(id)?.bytes ?? 0), 0);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setMany = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const remove = async () => {
    const ids = [...picked];
    try {
      const res = await api.remove(ids, false);
      toast(
        {
          text: t("lib.movedToBin", { n: res.deleted }),
          action: { label: t("common.undo"), run: () => api.undoDelete().then(() => scan()) },
        },
        7000,
      );
      scan();
    } catch (e) {
      toast({ text: t("common.error", { msg: errorText(e) }), error: true });
    }
  };

  return (
    <div className="page cleanup">
      <h1 className="page-title display">{t("clean.title")}</h1>
      <p className="page-intro">{t("clean.intro")}</p>

      {!data ? (
        <p className="muted">{t("clean.scanning")}</p>
      ) : (
        <>
          <Group title={t("clean.duplicates")} hint={t("clean.duplicatesHint")} shots={data.duplicates.flat()} picked={picked} setMany={setMany}>
            {data.duplicates.map((g) => (
              <div key={g[0].id} className="dup-group">
                {g.map((s) => (
                  <Mini key={s.id} shot={s} on={picked.has(s.id)} onToggle={() => toggle(s.id)} />
                ))}
              </div>
            ))}
          </Group>
          <Group title={t("clean.old")} shots={data.old} picked={picked} setMany={setMany}>
            <div className="mini-grid">
              {data.old.map((s) => (
                <Mini key={s.id} shot={s} on={picked.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </div>
          </Group>
          <Group title={t("clean.large")} shots={data.large} picked={picked} setMany={setMany}>
            <div className="mini-grid">
              {data.large.map((s) => (
                <Mini key={s.id} shot={s} on={picked.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </div>
          </Group>
        </>
      )}

      {picked.size > 0 && (
        <div className="cleanup-bar">
          <span className="display">{t("lib.selected", { n: picked.size })}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-danger-solid" onClick={remove}>
            <Trash2 size={15} /> {t("clean.deleteN", { n: picked.size, size: formatBytes(bytes) })}
          </button>
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  hint,
  shots,
  picked,
  setMany,
  children,
}: {
  title: string;
  hint?: string;
  shots: Shot[];
  picked: Set<string>;
  setMany: (ids: string[], on: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();
  const ids = shots.map((s) => s.id);
  const allOn = ids.length > 0 && ids.every((id) => picked.has(id));
  return (
    <section className="clean-group">
      <div className="clean-head">
        <h2 className="display">{title}</h2>
        <span className="edge">
          {shots.length} · {formatBytes(shots.reduce((a, s) => a + s.bytes, 0))}
        </span>
        <span style={{ flex: 1 }} />
        {ids.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setMany(ids, !allOn)}>
            {allOn ? t("clean.selectNone") : t("clean.selectAll")}
          </button>
        )}
      </div>
      {hint && <p className="muted clean-hint">{hint}</p>}
      {shots.length === 0 ? <p className="muted">{t("clean.none")}</p> : children}
    </section>
  );
}

function Mini({ shot, on, onToggle }: { shot: Shot; on: boolean; onToggle: () => void }) {
  const lang = useLang();
  return (
    <button className={`mini${on ? " on" : ""}`} onClick={onToggle} onDoubleClick={() => api.openEditor(`shot:${shot.id}`)} title={shot.name}>
      <div className={`mini-thumb checker${on ? " brackets" : ""}`}>
        <img src={thumbUrl(shot)} alt="" loading="lazy" draggable={false} />
        <span className="mini-check">{on && <Check size={13} strokeWidth={3} />}</span>
      </div>
      <div className="edge">
        {formatBytes(shot.bytes)} · {formatDate(shot.created, lang)}
      </div>
    </button>
  );
}

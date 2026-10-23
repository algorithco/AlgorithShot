// Privacy check in the editor: finds emails, phones, cards, IDs, keys and
// faces in the current image and hides the ones you tick, in one step.

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { editorApi, errorText, type Finding, type Rect } from "../shared/api";
import { useT, type Key } from "../shared/i18n";
import { Segmented, toast } from "../shared/ui";
import type { HideStyle } from "./doc";
import { Section } from "./Panels";
import { rgbaOf } from "./render";

export function PrivacyPanel({
  base,
  version,
  open,
  onHide,
}: {
  base: OffscreenCanvas | null;
  version: number;
  open: boolean;
  onHide: (rects: Rect[], style: HideStyle) => void;
}) {
  const t = useT();
  // Results belong to the image version they were found in; an edit makes
  // them stale.
  const [result, setResult] = useState<{ version: number; findings: Finding[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [style, setStyle] = useState<HideStyle>("pixelate");
  const autoScanned = useRef(false);
  const findings = result && result.version === version ? result.findings : null;

  const scan = useCallback(async () => {
    if (!base) return;
    const at = version;
    setScanning(true);
    try {
      const found = await editorApi.privacyScan(rgbaOf(base), base.width, base.height);
      setResult({ version: at, findings: found });
      setPicked(new Set(found.map((_, i) => i)));
    } catch (e) {
      toast({ text: t("common.error", { msg: errorText(e) }), error: true });
    } finally {
      setScanning(false);
    }
  }, [base, version, t]);

  // Opened from "N private items found": look straight away, once.
  useEffect(() => {
    if (open && base && !autoScanned.current) {
      autoScanned.current = true;
      scan();
    }
  }, [open, base, scan]);

  return (
    <Section title={t("ed.privacy")}>
      {findings === null ? (
        <button className="btn wide" onClick={scan} disabled={scanning || !base}>
          <ShieldAlert size={15} /> {scanning ? t("ed.scanning") : t("ed.scan")}
        </button>
      ) : findings.length === 0 ? (
        <p className="ed-ok">
          <ShieldCheck size={16} /> {t("ed.noneFound")}
        </p>
      ) : (
        <>
          <p className="ed-hint">{t("ed.found", { n: findings.length })}</p>
          <ul className="findings">
            {findings.map((f, i) => (
              <li key={i}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    onChange={() =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                  <span className="finding-kind">{t(`pv.${f.kind}` as Key)}</span>
                  <span className="finding-text">{f.preview}</span>
                </label>
              </li>
            ))}
          </ul>
          <Segmented
            value={style}
            onChange={setStyle}
            options={[
              { value: "pixelate", label: t("ed.pixelate") },
              { value: "solid", label: t("ed.solid") },
            ]}
          />
          <button
            className="btn btn-primary wide"
            disabled={!picked.size}
            onClick={() => {
              onHide(
                findings.filter((_, i) => picked.has(i)).map((f) => pad(f.rect, base)),
                style,
              );
              setResult(null);
            }}
          >
            {t("ed.hideSelected")}
          </button>
        </>
      )}
    </Section>
  );
}

/** A little extra room so letter edges don't peek out. */
function pad(r: Rect, base: OffscreenCanvas | null): Rect {
  const p = Math.max(2, Math.round(r.h * 0.15));
  const x = Math.max(0, r.x - p);
  const y = Math.max(0, r.y - p);
  const right = Math.min(base?.width ?? r.x + r.w + p, r.x + r.w + p);
  const bottom = Math.min(base?.height ?? r.y + r.h + p, r.y + r.h + p);
  return { x, y, w: right - x, h: bottom - y };
}

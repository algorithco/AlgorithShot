// The editor's side panels: tool options, perfect size and export.

import { Lock, LockOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Rect, SaveFormat } from "../shared/api";
import { formatBytes } from "../shared/format";
import { useT, type Key } from "../shared/i18n";
import { Segmented } from "../shared/ui";
import { SIZE_PRESETS, type Mark } from "./doc";
import type { Options, Tool } from "./Stage";

export const COLORS = ["#E5484D", "#FFD300", "#3E7BFA", "#2FB26B", "#16191E", "#FFFFFF"];
export const HIGHLIGHTS = ["#FFE066", "#A5E887", "#FFB3CF", "#A6CFFF", "#FFC48A"];

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <h3 className="edge">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup">
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value.toLowerCase() === c.toLowerCase()}
          className="swatch-btn"
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <input type="color" className="swatch-custom" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
    </div>
  );
}

function Slider({ value, min, max, onChange, suffix = "" }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="ed-slider">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="measure">
        {value}
        {suffix}
      </span>
    </div>
  );
}

const RATIOS: { label: string; value: number | null | "original" }[] = [
  { label: "ed.free", value: null },
  { label: "ed.original", value: "original" },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "3:2", value: 3 / 2 },
];

export function ToolOptions(props: {
  tool: Tool;
  opts: Options;
  onOpts: (patch: Partial<Options>) => void;
  selectedMark: Mark | null;
  crop: Rect | null;
  onCrop: (r: Rect) => void;
  cropRatio: number | null;
  onCropRatio: (r: number | null) => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  docSize: { w: number; h: number };
}) {
  const t = useT();
  const { tool, opts, onOpts, selectedMark } = props;
  const markTool = selectedMark?.kind ?? tool;
  const showColor = ["arrow", "box", "text", "step"].includes(markTool);
  const title = t(`ed.tool.${tool}` as Key).replace(/\s*\(.*\)$/, "");

  return (
    <Section title={title}>
      <p className="ed-hint">{t(`ed.hint.${tool}` as Key)}</p>

      {tool === "crop" && props.crop && (
        <>
          <Field label={t("ed.ratio")}>
            <div className="chips">
              {RATIOS.map((r) => {
                const value = r.value === "original" ? props.docSize.w / props.docSize.h : r.value;
                const active = value === null ? props.cropRatio === null : props.cropRatio !== null && Math.abs(props.cropRatio - value) < 0.001;
                return (
                  <button key={r.label} className={`chip${active ? " on" : ""}`} onClick={() => props.onCropRatio(value)}>
                    {r.label.startsWith("ed.") ? t(r.label as Key) : r.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="ed-row2">
            <Field label={t("ed.w")}>
              <NumberInput value={props.crop.w} max={props.docSize.w} onChange={(w) => props.onCrop({ ...props.crop!, w, h: props.cropRatio ? Math.round(w / props.cropRatio) : props.crop!.h })} />
            </Field>
            <Field label={t("ed.h")}>
              <NumberInput value={props.crop.h} max={props.docSize.h} onChange={(h) => props.onCrop({ ...props.crop!, h, w: props.cropRatio ? Math.round(h * props.cropRatio) : props.crop!.w })} />
            </Field>
          </div>
          <div className="ed-actions">
            <button className="btn" onClick={props.onCancelCrop}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" onClick={props.onApplyCrop}>
              {t("ed.apply")}
            </button>
          </div>
        </>
      )}

      {tool === "erase" && (
        <>
          <Field label={t("ed.style")}>
            <Segmented
              value={opts.eraseMode}
              onChange={(v) => onOpts({ eraseMode: v })}
              options={[
                { value: "box", label: t("ed.box") },
                { value: "brush", label: t("ed.brush") },
              ]}
            />
          </Field>
          {opts.eraseMode === "brush" && (
            <Field label={t("ed.brushSize")}>
              <Slider value={opts.brush} min={4} max={120} onChange={(v) => onOpts({ brush: v })} suffix=" px" />
            </Field>
          )}
        </>
      )}

      {tool === "hide" && (
        <>
          <Field label={t("ed.style")}>
            <Segmented
              value={opts.hide}
              onChange={(v) => onOpts({ hide: v })}
              options={[
                { value: "pixelate", label: t("ed.pixelate") },
                { value: "blur", label: t("ed.blur") },
                { value: "solid", label: t("ed.solid") },
              ]}
            />
          </Field>
          {opts.hide !== "solid" && (
            <Field label={t("ed.strength")}>
              <Slider value={opts.strength} min={4} max={40} onChange={(v) => onOpts({ strength: v })} />
            </Field>
          )}
          <p className="ed-note">{t("ed.solidHint")}</p>
        </>
      )}

      {tool === "cut" && (
        <Field label={t("ed.style")}>
          <Segmented
            value={opts.axis}
            onChange={(v) => onOpts({ axis: v })}
            options={[
              { value: "horizontal", label: t("ed.horizontal") },
              { value: "vertical", label: t("ed.vertical") },
            ]}
          />
        </Field>
      )}

      {(showColor || markTool === "highlight") && (
        <Field label={t("ed.color")}>
          {markTool === "highlight" ? (
            <Swatches colors={HIGHLIGHTS} value={opts.highlight} onChange={(c) => onOpts({ highlight: c })} />
          ) : (
            <Swatches colors={COLORS} value={opts.color} onChange={(c) => onOpts({ color: c })} />
          )}
        </Field>
      )}
      {(markTool === "arrow" || markTool === "box") && (
        <Field label={t("ed.width")}>
          <Slider value={Math.round(opts.width)} min={2} max={24} onChange={(v) => onOpts({ width: v })} />
        </Field>
      )}
      {markTool === "text" && (
        <Field label={t("ed.size")}>
          <Slider value={Math.round(opts.textSize)} min={12} max={96} onChange={(v) => onOpts({ textSize: v })} />
        </Field>
      )}
      {markTool === "step" && (
        <Field label={t("ed.size")}>
          <Slider value={Math.round(opts.stepSize)} min={18} max={80} onChange={(v) => onOpts({ stepSize: v })} />
        </Field>
      )}
    </Section>
  );
}

function NumberInput({ value, max, onChange }: { value: number; max?: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= 1) onChange(max ? Math.min(n, max) : n);
    else setText(String(value));
  };
  return (
    <input
      className="input measure num"
      value={text}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

type Bg = "transparent" | "white" | "black";
const BG: Record<Bg, number[]> = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 255], black: [22, 25, 30, 255] };

export function SizePanel({ size, onApply }: { size: { w: number; h: number }; onApply: (w: number, h: number, mode: "resize" | "fit", bg: number[]) => void }) {
  const t = useT();
  const [w, setW] = useState(size.w);
  const [h, setH] = useState(size.h);
  const [lock, setLock] = useState(true);
  const [mode, setMode] = useState<"resize" | "fit">("resize");
  const [bg, setBg] = useState<Bg>("white");
  useEffect(() => {
    setW(size.w);
    setH(size.h);
  }, [size.w, size.h]);

  const ratio = size.w / Math.max(1, size.h);
  const changed = w !== size.w || h !== size.h;

  return (
    <Section title={t("ed.perfect")}>
      <div className="ed-row2 ed-size">
        <Field label={t("ed.w")}>
          <NumberInput
            value={w}
            max={20000}
            onChange={(v) => {
              setW(v);
              if (lock && mode === "resize") setH(Math.max(1, Math.round(v / ratio)));
            }}
          />
        </Field>
        <button className={`icon-btn lock${lock ? " on" : ""}`} title={t("ed.lock")} aria-pressed={lock} onClick={() => setLock(!lock)}>
          {lock ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        <Field label={t("ed.h")}>
          <NumberInput
            value={h}
            max={20000}
            onChange={(v) => {
              setH(v);
              if (lock && mode === "resize") setW(Math.max(1, Math.round(v * ratio)));
            }}
          />
        </Field>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "resize", label: t("ed.resize") },
          { value: "fit", label: t("ed.fitMode") },
        ]}
      />
      {mode === "fit" && (
        <Field label={t("ed.background")}>
          <Segmented
            value={bg}
            onChange={setBg}
            options={[
              { value: "white", label: t("ed.white") },
              { value: "black", label: t("ed.black") },
              { value: "transparent", label: t("ed.transparent") },
            ]}
          />
        </Field>
      )}
      <Field label={t("ed.presets")}>
        <div className="presets">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`preset${w === p.w && h === p.h ? " on" : ""}`}
              onClick={() => {
                setW(p.w);
                setH(p.h);
                // Presets rarely match the image's shape; fit avoids stretching.
                if (Math.abs(p.w / p.h - ratio) > 0.01) setMode("fit");
              }}
            >
              <span>{p.label}</span>
              <span className="measure">
                {p.w} × {p.h}
              </span>
            </button>
          ))}
        </div>
      </Field>
      <button className="btn btn-primary wide" disabled={!changed} onClick={() => onApply(w, h, mode, BG[bg])}>
        {t("ed.applySize")}
      </button>
    </Section>
  );
}

export function ExportPanel(props: {
  format: SaveFormat;
  onFormat: (f: SaveFormat) => void;
  quality: number;
  onQuality: (q: number) => void;
  maxKb: number;
  onMaxKb: (kb: number) => void;
  estimate: { bytes: number; quality: number } | "tooBig" | null;
}) {
  const t = useT();
  return (
    <Section title={t("ed.export")}>
      <Field label={t("ed.format")}>
        <Segmented
          value={props.format}
          onChange={props.onFormat}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
            { value: "webp", label: "WebP" },
          ]}
        />
      </Field>
      {props.format !== "png" && !props.maxKb && (
        <Field label={t("ed.quality")}>
          <Slider value={props.quality} min={30} max={100} onChange={props.onQuality} />
        </Field>
      )}
      <Field label={t("ed.maxSize")}>
        <div className="ed-maxsize">
          <input
            className="input measure num"
            inputMode="numeric"
            placeholder="—"
            value={props.maxKb || ""}
            onChange={(e) => props.onMaxKb(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
          />
          <span>{t("ed.kb")}</span>
        </div>
      </Field>
      <p className={`ed-estimate${props.estimate === "tooBig" ? " bad" : ""}`}>
        {props.estimate === "tooBig"
          ? t("ed.tooBig")
          : props.estimate
            ? `${t("ed.estimate", { size: formatBytes(props.estimate.bytes) })}${props.format !== "png" ? ` · ${t("ed.quality")} ${props.estimate.quality}` : ""}`
            : "…"}
      </p>
    </Section>
  );
}

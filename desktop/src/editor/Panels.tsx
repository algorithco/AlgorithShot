// The editor's side panels: tool options, perfect size and export.

import { Lock, LockOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Rect, SaveFormat } from "../shared/api";
import { formatBytes } from "../shared/format";
import { useT, type Key } from "../shared/i18n";
import { Segmented } from "../shared/ui";
import { SIZE_PRESETS, type Mark } from "./doc";
import { sizeCrop } from "./crop";
import type { Options, Tool } from "./Stage";

export const COLORS = ["#16191E", "#FFFFFF", "#8B8D98", "#E5484D", "#F76B15", "#FFD300", "#2FB26B", "#12A594", "#3E7BFA", "#6E56CF", "#D6409F", "#8E654D"];
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
    <div className="ed-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  const t = useT();
  return (
    <div className="swatches" role="group" aria-label={t("ed.palette")}>
      {colors.map((c) => (
        <button
          key={c}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          className="swatch-btn"
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function ColorPanel({ value, colors, onChange }: { value: string; colors: string[]; onChange: (c: string) => void }) {
  const t = useT();
  const [hex, setHex] = useState(value.toUpperCase());
  useEffect(() => setHex(value.toUpperCase()), [value]);
  const channels = [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16));
  const commitHex = () => {
    let next = hex.trim().replace(/^#/, "");
    if (/^[\da-f]{3}$/i.test(next)) next = next.split("").map((c) => c + c).join("");
    if (/^[\da-f]{6}$/i.test(next)) {
      onChange(`#${next.toUpperCase()}`);
      setHex(`#${next.toUpperCase()}`);
    } else setHex(value.toUpperCase());
  };
  return (
    <div className="ed-color-panel">
      <div className="ed-color-custom">
        <input type="color" className="swatch-custom" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("ed.customColor")} title={t("ed.customColor")} />
        <label className="ed-field ed-hex">
          <span>HEX</span>
          <input className="input measure" value={hex} maxLength={7} spellCheck={false} aria-label={t("ed.hex")} onChange={(e) => setHex(e.target.value)} onBlur={commitHex} onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitHex(); }
            if (e.key === "Escape") { e.preventDefault(); setHex(value.toUpperCase()); }
          }} />
        </label>
      </div>
      <div className="ed-rgb" role="group" aria-label={t("ed.rgb")}>
        {["R", "G", "B"].map((channel, index) => (
          <label className="ed-field" key={channel}>
            <span className={`ed-channel ed-channel-${channel.toLowerCase()}`}>{channel}</span>
            <ChannelInput value={channels[index]} label={t(["ed.red", "ed.green", "ed.blue"][index] as Key)} onChange={(n) => {
              const next = [...channels];
              next[index] = n;
              onChange(`#${next.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
            }} />
          </label>
        ))}
      </div>
      <Swatches colors={colors} value={value} onChange={onChange} />
    </div>
  );
}

function ChannelInput({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.max(0, Math.min(255, Math.round(Number(draft))));
    if (draft.trim() && Number.isFinite(n)) { if (n !== value) onChange(n); setDraft(String(n)); }
    else setDraft(String(value));
  };
  return <input className="input measure num" type="number" min={0} max={255} step={1} value={draft} aria-label={label} onChange={(e) => {
    const next = e.target.value;
    setDraft(next);
    if (next !== "" && Number(next) >= 0 && Number(next) <= 255 && Math.round(Number(next)) !== value) onChange(Math.round(Number(next)));
  }} onBlur={commit} onKeyDown={(e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
  }} />;
}

function Slider({ value, min, max, onChange, suffix = "", label, numeric = false }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string; label?: string; numeric?: boolean }) {
  return (
    <div className="ed-slider">
      <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      {numeric ? <NumberInput value={value} min={min} max={max} label={label} onChange={onChange} /> : <span className="measure">{value}{suffix}</span>}
      {numeric && suffix && <span className="ed-slider-unit">{suffix.trim()}</span>}
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
  const markTool = selectedMark?.kind === "stroke" ? selectedMark.tool : selectedMark?.kind ?? tool;
  const showColor = ["pen", "pencil", "marker", "line", "ellipse", "arrow", "box", "highlight", "text", "step"].includes(markTool);
  const isHighlight = markTool === "highlight" || markTool === "marker";
  const color = selectedMark?.color ?? (isHighlight ? opts.highlight : opts.color);
  const width = selectedMark && "width" in selectedMark ? selectedMark.width : opts.width;
  const opacity = selectedMark ? ("opacity" in selectedMark ? selectedMark.opacity : undefined) ?? (selectedMark.kind === "highlight" ? 0.55 : markTool === "marker" ? 0.35 : 1) : opts.opacity;
  const filled = selectedMark && (selectedMark.kind === "box" || selectedMark.kind === "ellipse") ? selectedMark.fill ?? false : opts.fillShape;
  const isBrush = ["pen", "pencil", "marker"].includes(markTool);
  const showWidth = isBrush || ["line", "arrow", "box", "ellipse"].includes(markTool);
  const showOpacity = showWidth || markTool === "highlight";
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
              <NumberInput value={props.crop.w} max={props.docSize.w} label={t("ed.w")} onChange={(w) => {
                const next = sizeCrop(props.crop!, w, "w", props.docSize, props.cropRatio);
                props.onCrop(next);
                return next.w;
              }} />
            </Field>
            <Field label={t("ed.h")}>
              <NumberInput value={props.crop.h} max={props.docSize.h} label={t("ed.h")} onChange={(h) => {
                const next = sizeCrop(props.crop!, h, "h", props.docSize, props.cropRatio);
                props.onCrop(next);
                return next.h;
              }} />
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
              <Slider value={opts.brush} min={1} max={200} label={t("ed.brushSize")} numeric onChange={(v) => onOpts({ brush: v })} suffix=" px" />
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
              <Slider value={opts.strength} min={4} max={40} label={t("ed.strength")} onChange={(v) => onOpts({ strength: v })} />
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

      {showColor && (
        <Field label={t("ed.color")}>
          <ColorPanel colors={isHighlight ? [...HIGHLIGHTS, ...COLORS] : COLORS} value={color} onChange={(c) => onOpts(isHighlight ? { highlight: c } : { color: c })} />
        </Field>
      )}
      {isBrush && (
        <div className="ed-brush-preview" role="img" aria-label={t("ed.preview")}>
          <svg viewBox="0 0 250 64" aria-hidden="true">
            <path d="M22 42 C58 42 58 16 98 20 S145 49 177 32 S207 19 228 20" fill="none" stroke={color} strokeWidth={Math.min(32, width)} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
          </svg>
        </div>
      )}
      {showWidth && (
        <Field label={t("ed.width")}>
          <Slider value={Math.max(1, Math.round(width))} min={1} max={120} label={t("ed.width")} numeric suffix=" px" onChange={(v) => onOpts({ width: v })} />
        </Field>
      )}
      {showOpacity && (
        <Field label={t("ed.opacity")}>
          <Slider value={Math.round(opacity * 100)} min={1} max={100} label={t("ed.opacity")} suffix="%" onChange={(v) => onOpts({ opacity: v / 100 })} />
        </Field>
      )}
      {(markTool === "box" || markTool === "ellipse") && (
        <Field label={t("ed.fillShape")}>
          <Segmented value={filled ? "fill" : "outline"} onChange={(v) => onOpts({ fillShape: v === "fill" })} options={[
            { value: "outline", label: t("ed.outline") },
            { value: "fill", label: t("ed.filled") },
          ]} />
        </Field>
      )}
      {markTool === "text" && (
        <Field label={t("ed.size")}>
          <Slider value={Math.round(selectedMark?.kind === "text" ? selectedMark.size : opts.textSize)} min={12} max={96} label={t("ed.size")} onChange={(v) => onOpts({ textSize: v })} />
        </Field>
      )}
      {markTool === "step" && (
        <Field label={t("ed.size")}>
          <Slider value={Math.round(selectedMark?.kind === "step" ? selectedMark.size : opts.stepSize)} min={18} max={80} label={t("ed.size")} onChange={(v) => onOpts({ stepSize: v })} />
        </Field>
      )}
    </Section>
  );
}

/** Parse the full numeric value before rounding; removing punctuation changes its meaning. */
export function numericDraft(text: string, min = 1, max = Infinity): number | null {
  const n = Number(text);
  return text.trim() && Number.isFinite(n) ? Math.max(min, Math.min(Math.round(n), max)) : null;
}

function NumberInput({ value, min = 1, max, label, onChange }: { value: number; min?: number; max?: number; label?: string; onChange: (v: number) => number | void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const next = numericDraft(text, min, max);
    if (next !== null) {
      const applied = next !== value ? onChange(next) : value;
      setText(String(applied ?? next));
    } else setText(String(value));
  };
  return (
    <input
      className="input measure num"
      type="number"
      min={min}
      max={max}
      step={1}
      value={text}
      inputMode="numeric"
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setText(String(value)); }
      }}
    />
  );
}

type Bg = "transparent" | "white" | "black";
const BG: Record<Bg, number[]> = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 255], black: [22, 25, 30, 255] };

/** Constrain the linked dimension too, so a locked resize always fits the image limit. */
export function resizeDimensions(size: { w: number; h: number }, value: number, axis: "w" | "h", ratio: number | null, max = 20000): { w: number; h: number } {
  const clamp = (n: number) => Math.max(1, Math.min(max, Math.round(n)));
  const requested = clamp(value);
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return { w: clamp(size.w), h: clamp(size.h), [axis]: requested };
  let w = axis === "w" ? requested : requested * ratio;
  let h = axis === "h" ? requested : requested / ratio;
  const scale = Math.min(1, max / w, max / h);
  w = clamp(w * scale);
  h = clamp(h * scale);
  return { w, h };
}

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
            label={t("ed.w")}
            max={20000}
            onChange={(v) => {
              const next = resizeDimensions({ w, h }, v, "w", lock && mode === "resize" ? ratio : null);
              setW(next.w);
              setH(next.h);
              return next.w;
            }}
          />
        </Field>
        <button className={`icon-btn lock${lock ? " on" : ""}`} title={t("ed.lock")} aria-pressed={lock} onClick={() => setLock(!lock)}>
          {lock ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        <Field label={t("ed.h")}>
          <NumberInput
            value={h}
            label={t("ed.h")}
            max={20000}
            onChange={(v) => {
              const next = resizeDimensions({ w, h }, v, "h", lock && mode === "resize" ? ratio : null);
              setW(next.w);
              setH(next.h);
              return next.h;
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
          <Slider value={props.quality} min={30} max={100} label={t("ed.quality")} onChange={props.onQuality} />
        </Field>
      )}
      <Field label={t("ed.maxSize")}>
        <div className="ed-maxsize">
          <input
            className="input measure num"
            inputMode="numeric"
            aria-label={t("ed.maxSize")}
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

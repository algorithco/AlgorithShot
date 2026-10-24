// Small shared UI pieces: logo, switch, segmented control, dialog, toasts.

import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { prettyKey } from "./format";

export const LOGO_CORNERS = [
  "M25.5 44.5V30.4a4.9 4.9 0 0 1 4.9-4.9H44.5",
  "M55.5 25.5h14.1a4.9 4.9 0 0 1 4.9 4.9V44.5",
  "M74.5 55.5v14.1a4.9 4.9 0 0 1-4.9 4.9H55.5",
  "M44.5 74.5H30.4a4.9 4.9 0 0 1-4.9-4.9V55.5",
] as const;
export const LOGO_FRAME_PATH = LOGO_CORNERS.join("");

/** The app icon: viewfinder corners around the yellow dot, on ink (src-tauri/icons/logo.svg). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#111111" />
      <path
        d={LOGO_FRAME_PATH}
        fill="none"
        stroke="#ffffff"
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="50" r="11.3" fill="#ffd300" />
    </svg>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Keys({ value }: { value: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {prettyKey(value)
        .split(" + ")
        .map((k) => (
          <span key={k} className="kbd">
            {k}
          </span>
        ))}
    </span>
  );
}

/**
 * A modal dialog. It closes only through its own buttons: clicking outside
 * never closes it, and Esc cancels only when nothing has been typed into it
 * (`typed` true keeps Esc from throwing away input).
 */
export function Dialog({
  title,
  children,
  actions,
  onCancel,
  typed = false,
}: {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onCancel: () => void;
  typed?: boolean;
}) {
  useEffect(() => {
    if (typed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [typed, onCancel]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; error?: boolean; action?: { label: string; run: () => void } };

const useToastStore = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextToast = 1;

export function toast(t: Omit<Toast, "id">, ms = 5000) {
  const id = nextToast++;
  useToastStore.setState((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
  window.setTimeout(() => useToastStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.error ? " error" : ""}${t.action ? "" : " plain"}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                useToastStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

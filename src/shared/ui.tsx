// Small shared UI pieces: logo, switch, segmented control, dialog, toasts.

import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { prettyKey } from "./format";

/** Viewfinder corners with the amber tally dot. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M4 11V6a2 2 0 0 1 2-2h5M21 4h5a2 2 0 0 1 2 2v5M28 21v5a2 2 0 0 1-2 2h-5M11 28H6a2 2 0 0 1-2-2v-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.5" fill="#ffb400" />
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

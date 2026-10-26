import type { Lang } from "./i18n";

const locales: Record<Lang, string> = { en: "en-GB", uz: "uz-Latn-UZ", ru: "ru-RU" };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleDateString(locales[lang], { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleString(locales[lang], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleTimeString(locales[lang], { hour: "2-digit", minute: "2-digit" });
}

/** "today", "yesterday" or a date key like "2026-10-21", in local time. */
export function dayKey(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (key(d) === key(today)) return "today";
  if (key(d) === key(yesterday)) return "yesterday";
  return key(d);
}

/** Shows a shortcut the way Windows writes it: "Ctrl + Shift + S", "Print Screen". */
export function prettyKey(key: string): string {
  return key
    .split("+")
    .map((k) => {
      if (k === "PrintScreen") return "Print Screen";
      if (k === "Super") {
        const platform = typeof navigator === "undefined" ? "" : navigator.platform;
        return /Mac/.test(platform) ? "Cmd" : /Win/.test(platform) ? "Win" : "Super";
      }
      if (/^Key[A-Z]$/.test(k)) return k.slice(3);
      if (/^Digit\d$/.test(k)) return k.slice(5);
      if (k.startsWith("Arrow")) return k.slice(5);
      return k;
    })
    .join(" + ");
}

/** Builds a shortcut string the hotkey parser understands from a key event. */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(code)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  const fn = /^F\d{1,2}$/.test(code);
  // A plain letter would fire while typing, so letters need a modifier.
  if (!mods.length && !fn && code !== "PrintScreen" && code !== "Pause" && code !== "ScrollLock") return null;
  return [...mods, code].join("+");
}

import { useCallback } from "react";
import { en, type Key } from "./en";
import { ru } from "./ru";
import { uz } from "./uz";
import { useSettings } from "../settings";

export type Lang = "en" | "uz" | "ru";
export type { Key };

const dicts: Record<Lang, Record<Key, string>> = { en, uz, ru };

export function resolveLang(setting: string | undefined): Lang {
  if (setting === "en" || setting === "uz" || setting === "ru") return setting;
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("uz")) return "uz";
  if (nav.startsWith("ru")) return "ru";
  return "en";
}

export type Vars = Record<string, string | number>;

/** Fills `{name}` placeholders that appear in `vars`; others stay as typed. */
export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const text = dicts[lang][key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function useLang(): Lang {
  const settings = useSettings((s) => s.settings);
  return resolveLang(settings?.language);
}

export function useT() {
  const lang = useLang();
  return useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
}

import type { Hotkeys, Settings } from "../shared/api";
import type { Key } from "../shared/i18n";

export const SETUP_VERSION = 1;
export const SETUP_STEPS = ["personalize", "capture", "saving", "smart", "review"] as const;
export type SetupStep = typeof SETUP_STEPS[number];
export type SetupIssue = { step: SetupStep; key: Key };

export function needsSetup(settings: { setupVersion?: number } | null | undefined): boolean {
  return !Number.isInteger(settings?.setupVersion) || (settings?.setupVersion ?? 0) < SETUP_VERSION;
}

export function setupDraft(settings: Settings): Settings {
  return { ...settings, hotkeys: { ...settings.hotkeys } };
}

function normalizedShortcut(shortcut: string): string {
  return shortcut.split("+").map((part) => {
    const key = part.trim().toLowerCase();
    if (/^key[a-z]$/.test(key)) return key.slice(3);
    if (/^digit\d$/.test(key)) return key.slice(5);
    return key === "control" ? "ctrl" : key === "win" || key === "meta" ? "super" : key;
  }).sort().join("+");
}

export function duplicateShortcuts(hotkeys: Hotkeys): string[] {
  const seen = new Set<string>();
  return Object.values(hotkeys).filter((shortcut) => {
    if (!shortcut.trim()) return false;
    const key = normalizedShortcut(shortcut);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

export function validateSetup(settings: Settings): SetupIssue[] {
  const issues: SetupIssue[] = [];
  if (duplicateShortcuts(settings.hotkeys).length) issues.push({ step: "capture", key: "setup.duplicateKeys" });
  if (!settings.filePattern.trim()) issues.push({ step: "saving", key: "setup.patternRequired" });
  return issues;
}

/** Match the filename sanitization used by shots::file_stem in the backend. */
export function setupFilename(settings: Pick<Settings, "filePattern" | "format">, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  let stem = settings.filePattern.replace(/\{app\}/g, "Telegram").replace(/\{title\}/g, "Project notes")
    .replace(/\{date\}/g, date).replace(/\{time\}/g, time)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim();
  if (!stem) stem = `Screenshot ${date} ${time}`;
  if (["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2", "LPT3"].includes(stem.toUpperCase())) stem += "_";
  stem = [...stem].slice(0, 150).join("");
  return `${stem}.${settings.format === "jpeg" ? "jpg" : settings.format}`;
}

export async function commitSetup(draft: Settings, save: (settings: Settings) => Promise<Settings>): Promise<Settings> {
  if (validateSetup(draft).length) throw new Error("Invalid setup choices");
  return save({ ...setupDraft(draft), filePattern: draft.filePattern.trim(), welcomeDone: true, setupVersion: SETUP_VERSION });
}

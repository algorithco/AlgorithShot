// Typed wrappers around the Rust commands, plus the shapes they return.

import { invoke } from "@tauri-apps/api/core";

export type Rect = { x: number; y: number; w: number; h: number };

export type MonitorInfo = {
  id: number;
  name: string;
  rect: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
};

export type WindowInfo = {
  hwnd: number;
  rect: Rect;
  title: string;
  app: string;
  class: string;
};

export type Hotkeys = {
  capture: string;
  captureAlt: string;
  text: string;
  qr: string;
  fullScreen: string;
  repeat: string;
  library: string;
};

export type Settings = {
  language: "system" | "en" | "uz" | "ru";
  theme: "system" | "light" | "dark";
  saveDir: string;
  saveAll: boolean;
  filePattern: string;
  format: "png" | "jpeg" | "webp";
  jpegQuality: number;
  webpQuality: number;
  copyAfterCapture: boolean;
  showCard: boolean;
  openEditor: boolean;
  cardSeconds: number;
  magnifier: boolean;
  snap: boolean;
  elements: boolean;
  hotkeys: Hotkeys;
  launchAtLogin: boolean;
  indexText: boolean;
  privacyCheck: boolean;
  autoCleanDays: number;
  sound: boolean;
  welcomeDone: boolean;
};

export type Shot = {
  id: string;
  path: string;
  name: string;
  created: number;
  width: number;
  height: number;
  bytes: number;
  format: string;
  app: string;
  title: string;
  url: string;
  favorite: boolean;
  edited: boolean;
  textState: number;
  privacy: number;
  rev: number;
};

export type ShotDetail = {
  shot: Shot;
  text: string;
  hasOriginal: boolean;
  privacyJson: string;
};

export type ListQuery = {
  search?: string;
  filter?: "all" | "favorites" | "today" | "week" | "month";
  app?: string;
  offset?: number;
  limit?: number;
};

export type HotkeyStatus = { action: string; key: string; ok: boolean; error: string | null };

export type AppInfo = {
  version: string;
  saveDir: string;
  defaultSaveDir: string;
  saveDirSynced: boolean;
  printScreenTaken: boolean;
  language: "en" | "uz" | "ru";
};

export type Overview = {
  stats: { count: number; bytes: number };
  apps: { app: string; count: number }[];
};

export type Cleanup = { duplicates: Shot[][]; old: Shot[]; large: Shot[] };

export type CommitAction = "done" | "copy" | "save_as" | "edit" | "pin" | "text" | "qr";

export type CardPayload =
  | { kind: "shot"; shot: Shot | null; tempId: string | null; width: number; height: number; copied: boolean }
  | { kind: "text"; text: string; copied: boolean }
  | { kind: "qr"; items: string[]; copied: boolean }
  | { kind: "color"; hex: string }
  | { kind: "countdown"; seconds: number }
  | { kind: "saved"; path: string }
  | { kind: "message"; text: string; error: boolean };

/** URL of something served by the app's `shot://` protocol. (In a plain
 *  browser during development, dev/mock.ts points this at fake images.) */
export function shotUrl(path: string): string {
  const base = (globalThis as { __SHOT_BASE__?: string }).__SHOT_BASE__ ?? "http://shot.localhost/";
  return `${base}${path}`;
}

export const thumbUrl = (s: Shot) => shotUrl(`thumb/${s.id}?v=${s.rev}`);
export const imageUrl = (s: Shot) => shotUrl(`image/${s.id}?v=${s.rev}`);

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  hotkeyStatus: () => invoke<HotkeyStatus[]>("hotkey_status"),
  hotkeysSuspend: (suspend: boolean) => invoke<HotkeyStatus[]>("hotkeys_suspend", { suspend }),
  appInfo: () => invoke<AppInfo>("app_info"),
  openKeyboardSettings: () => invoke<void>("open_keyboard_settings"),
  pickFolder: () => invoke<string | null>("pick_folder"),

  captureStart: (mode: string, delay?: number) => invoke<void>("capture_start", { mode, delay }),
  overlayReady: (sessionId: number, monitorId: number) => invoke<void>("overlay_ready", { sessionId, monitorId }),
  overlayHide: () => invoke<void>("overlay_hide"),
  captureCancel: (sessionId: number) => invoke<void>("capture_cancel", { sessionId }),
  captureCommit: (req: { sessionId: number; monitorId: number; rect: Rect; action: CommitAction; allScreens?: boolean }) =>
    invoke<void>("capture_commit", { req }),
  copyColor: (hex: string) => invoke<void>("copy_color", { hex }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),

  cardReady: (width: number, height: number) => invoke<void>("card_ready", { width, height }),
  cardHide: () => invoke<void>("card_hide"),
  tempSave: (tempId: string) => invoke<Shot>("temp_save", { tempId }),
  tempCopy: (tempId: string) => invoke<void>("temp_copy", { tempId }),
  tempPin: (tempId: string) => invoke<void>("temp_pin", { tempId }),

  list: (query: ListQuery) => invoke<{ items: Shot[]; total: number }>("library_list", { query }),
  overview: () => invoke<Overview>("library_overview"),
  get: (id: string) => invoke<ShotDetail>("library_get", { id }),
  remove: (ids: string[], permanent: boolean) =>
    invoke<{ deleted: number; canUndo: boolean }>("library_delete", { ids, permanent }),
  undoDelete: () => invoke<number>("library_undo_delete"),
  rename: (id: string, name: string) => invoke<Shot>("library_rename", { id, name }),
  favorite: (id: string, value: boolean) => invoke<void>("library_favorite", { id, value }),
  reveal: (id: string) => invoke<void>("library_reveal", { id }),
  openFolder: () => invoke<void>("library_open_folder"),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  dragIcon: (id: string | null, tempId: string | null = null) => invoke<string>("drag_icon", { id, tempId }),
  tempFile: (tempId: string) => invoke<string>("temp_file", { tempId }),
  copy: (ids: string[], asFile = false) => invoke<void>("library_copy", { ids, asFile }),
  pin: (id: string) => invoke<void>("library_pin", { id }),
  pinClosed: (id: string) => invoke<void>("pin_closed", { id }),
  openEditor: (target: string, panel?: string) => invoke<void>("open_editor", { target, panel }),
  showLibrary: (page?: string) => invoke<void>("show_library", { page }),
  cleanupScan: () => invoke<Cleanup>("cleanup_scan"),
  shareTelegram: (id: string | null, tempId: string | null = null) => invoke<boolean>("share_telegram", { id, tempId }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

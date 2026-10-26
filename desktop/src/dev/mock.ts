// Dev only: fakes the Rust side so the pages run in a normal browser
// (`pnpm dev`, then open /index.html, /overlay.html, /card.html…).
// Never loaded inside the real app.

import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { CardPayload, Rect, Settings, Shot, TextLine } from "../shared/api";

const APPS = ["Telegram", "Chrome", "Edge", "VS Code", "Excel", "Explorer", "Figma"];
const TITLES: Record<string, string> = {
  Telegram: "Algorithco Team",
  Chrome: "Payme — To'lov tarixi",
  Edge: "Uzum Market",
  "VS Code": "capture.rs — algorithco-shot",
  Excel: "Hisobot 2026.xlsx",
  Explorer: "Downloads",
  Figma: "Landing page v3",
};

function makeShots(count: number): Shot[] {
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: count }, (_, i) => {
    const app = APPS[(i * 3 + (i >> 2)) % APPS.length];
    const created = now - Math.round(i * i * 0.6 * 3_600_000) - i * 900_000;
    const d = new Date(created);
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const sizes: [number, number][] = [
      [1280, 720],
      [1920, 1080],
      [820, 640],
      [1080, 1080],
      [640, 420],
    ];
    const [width, height] = sizes[i % sizes.length];
    return {
      id: `mock-${i}`,
      path: `C:\\Users\\you\\Pictures\\AlgorithShot\\${app} ${stamp}.png`,
      name: `${app} ${stamp}.png`,
      created,
      width,
      height,
      bytes: 60_000 + ((i * 7919) % 900_000) + (i % 9 === 0 ? 4_000_000 : 0),
      format: "png",
      app,
      title: TITLES[app],
      url: app === "Chrome" || app === "Edge" ? "https://example.uz/" : "",
      favorite: i % 6 === 2,
      edited: i % 8 === 3,
      textState: i === 1 ? 0 : 1,
      privacy: i % 5 === 1 ? 2 : 0,
      rev: 0,
    };
  });
}

const settings: Settings = {
  language: "system",
  theme: "system",
  saveDir: "",
  saveAll: true,
  filePattern: "{app} {date} {time}",
  format: "png",
  jpegQuality: 90,
  webpQuality: 90,
  copyAfterCapture: true,
  showCard: true,
  openEditor: false,
  cardSeconds: 6,
  snap: true,
  highlight: false,
  elements: true,
  hotkeys: { capture: "Ctrl+Alt+A", captureAlt: "PrintScreen", text: "", qr: "", fullScreen: "", repeat: "", library: "" },
  launchAtLogin: false,
  indexText: true,
  privacyCheck: true,
  autoCleanDays: 0,
  sound: false,
  welcomeDone: true,
  setupVersion: 1,
};

let shots = makeShots(46);
let trash: Shot[] = [];
const params = new URLSearchParams(location.search);
if (params.has("empty")) shots = [];
if (params.has("welcome") || params.has("setup")) {
  settings.welcomeDone = false;
  settings.setupVersion = 0;
}
if (params.get("lang")) settings.language = params.get("lang") as Settings["language"];
if (params.get("theme")) settings.theme = params.get("theme") as Settings["theme"];
let setupSaveFailed = false;

const SAMPLE_TEXT = "Toʻlov muvaffaqiyatli amalga oshirildi\nSumma: 150 000 soʻm\nKarta: 8600 **** **** 1234\nSana: 23.10.2026 14:05";

function list(args: { query: { search?: string; filter?: string; app?: string; offset?: number; limit?: number } }) {
  const q = args.query;
  const term = (q.search ?? "").toLowerCase();
  const day = 86_400_000;
  const since = q.filter === "today" ? new Date().setHours(0, 0, 0, 0) : q.filter === "week" ? Date.now() - 7 * day : q.filter === "month" ? Date.now() - 30 * day : 0;
  const items = shots.filter(
    (s) =>
      (!term || `${s.name} ${s.app} ${s.title} ${s.url}`.toLowerCase().includes(term)) &&
      (q.filter !== "favorites" || s.favorite) &&
      s.created >= since &&
      (!q.app || s.app === q.app),
  );
  const offset = q.offset ?? 0;
  return { items: items.slice(offset, offset + (q.limit || 200)), total: items.length };
}

function overview() {
  const counts = new Map<string, number>();
  shots.forEach((s) => counts.set(s.app, (counts.get(s.app) ?? 0) + 1));
  return {
    stats: { count: shots.length, bytes: shots.reduce((a, s) => a + s.bytes, 0) },
    apps: [...counts].map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count),
  };
}

function handle(cmd: string, args: Record<string, unknown> = {}): unknown {
  switch (cmd) {
    case "get_settings":
      return settings;
    case "save_settings":
      if (params.has("setup-save-error") && !setupSaveFailed) {
        setupSaveFailed = true;
        throw new Error("The screenshot folder could not be written. Check the folder and try again.");
      }
      Object.assign(settings, args.settings);
      emit("settings:changed", settings);
      return settings;
    case "hotkey_status":
      return Object.entries(settings.hotkeys).filter(([, key]) => key.trim()).map(([action, key]) => ({
        action: action === "captureAlt" ? "capture" : action === "fullScreen" ? "screen" : action,
        key,
        ok: key.toLowerCase() !== "printscreen",
        error: key.toLowerCase() === "printscreen" ? "already registered" : null,
      }));
    case "hotkeys_suspend":
      return [];
    case "pick_folder":
      return "C:\\Users\\you\\Pictures\\My screenshots";
    case "app_info":
      return {
        version: "0.1.0",
        saveDir: "C:\\Users\\you\\Pictures\\AlgorithShot",
        defaultSaveDir: "C:\\Users\\you\\Pictures\\AlgorithShot",
        saveDirSynced: false,
        printScreenTaken: Object.values(settings.hotkeys).some((key) => key.toLowerCase() === "printscreen"),
        language: "en",
      };
    case "library_list":
      return list(args as never);
    case "library_overview":
      return overview();
    case "library_get": {
      const shot = shots.find((s) => s.id === args.id);
      return { shot, text: shot?.textState ? SAMPLE_TEXT : "", hasOriginal: !!shot?.edited, privacyJson: "" };
    }
    case "library_delete": {
      const ids = args.ids as string[];
      trash = shots.filter((s) => ids.includes(s.id));
      shots = shots.filter((s) => !ids.includes(s.id));
      setTimeout(() => emit("library:changed", ""), 10);
      return { deleted: ids.length, canUndo: !args.permanent };
    }
    case "library_undo_delete": {
      const n = trash.length;
      shots = [...shots, ...trash].sort((a, b) => b.created - a.created);
      trash = [];
      setTimeout(() => emit("library:changed", ""), 10);
      return n;
    }
    case "library_rename": {
      const shot = shots.find((s) => s.id === args.id)!;
      shot.name = `${args.name}.png`;
      setTimeout(() => emit("library:changed", shot.id), 10);
      return shot;
    }
    case "library_favorite": {
      const shot = shots.find((s) => s.id === args.id)!;
      shot.favorite = args.value as boolean;
      setTimeout(() => emit("library:changed", shot.id), 10);
      return null;
    }
    case "cleanup_scan": {
      const old = shots.filter((s) => s.created < Date.now() - 90 * 86_400_000 && !s.favorite);
      return { duplicates: [shots.slice(4, 7), shots.slice(10, 12)], old, large: shots.filter((s) => s.bytes > 3_000_000) };
    }
    case "share_telegram":
      return true;
    case "editor_info": {
      const shot = { ...shots[0], width: 1600, height: 1000 };
      return { name: shot.name, width: 1600, height: 1000, format: "png", hasOriginal: true, shot };
    }
    case "editor_estimate":
      return { bytes: 184_320, quality: 90 };
    case "editor_save":
      return shots[0];
    case "privacy_scan":
      return [
        { kind: "email", preview: "o•••@gmail.com", rect: { x: 470, y: 250, w: 360, h: 34 } },
        { kind: "phone", preview: "+998 •• ••• •• 67", rect: { x: 470, y: 330, w: 300, h: 34 } },
        { kind: "card", preview: "8600 •••• •••• 1234", rect: { x: 470, y: 410, w: 380, h: 34 } },
      ];
    case "capture_read_text":
      return new Promise((done) => setTimeout(() => done(fakeWords(args.rect as Rect)), 600));
    case "copy_text":
      // Lets a test see what would have gone to the clipboard.
      (globalThis as { __copied?: unknown }).__copied = args.text;
      return null;
    case "drag_icon":
    case "temp_file":
      return "C:\\temp\\x.png";
    default:
      console.debug("[mock]", cmd, args);
      return null;
  }
}

/** Rows of made-up words filling an area, like text recognition would return. */
function fakeWords(area: Rect): TextLine[] {
  const vocab = ["Salom", "dunyo", "Algorithco", "Shot", "matn", "nusxalash", "+998", "90", "123-45-67", "invoice", "2026", "Toshkent"];
  const lines: TextLine[] = [];
  for (let y = area.y + 14, n = 0; y + 26 < area.y + area.h; y += 42, n++) {
    const words: TextLine["words"] = [];
    for (let x = area.x + 16, i = 0; ; i++) {
      const text = vocab[(n * 5 + i * 3) % vocab.length];
      const w = text.length * 13 + 8;
      if (x + w > area.x + area.w - 12) break;
      words.push({ text, rect: { x, y, w, h: 26 } });
      x += w + 14;
    }
    if (words.length) lines.push({ words });
  }
  return lines;
}

const SAMPLE_CARDS: Record<string, CardPayload> = {
  shot: { kind: "shot", shot: null, tempId: null, width: 1280, height: 720, copied: true },
  temp: { kind: "shot", shot: null, tempId: "temp-1", width: 820, height: 640, copied: false },
  text: { kind: "text", text: SAMPLE_TEXT, copied: true },
  qr: { kind: "qr", items: ["https://algorithco.com/shot", "WIFI:T:WPA;S:Office;P:secret;;"], copied: true },
  color: { kind: "color", hex: "#FFD300" },
  countdown: { kind: "countdown", seconds: 5 },
  message: { kind: "message", text: "Something went wrong: the clipboard is busy", error: true },
};

export function installMocks(label: string) {
  (globalThis as { __SHOT_BASE__?: string }).__SHOT_BASE__ = "/dev-shot/";
  mockWindows(label);
  mockIPC((cmd, args) => handle(cmd, args as Record<string, unknown>), { shouldMockEvents: true });

  if (label === "overlay") {
    // A real overlay matches its monitor exactly, so fake a monitor with the
    // page's shape at 150% scaling. The fake desktop is laid out on 1920×1080.
    const W = Math.round(innerWidth * 1.5);
    const H = Math.round(innerHeight * 1.5);
    const sx = W / 1920;
    const sy = H / 1080;
    const r = (x: number, y: number, w: number, h: number) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) });
    setTimeout(
      () =>
        emit("overlay:start", {
          sessionId: 1,
          mode: params.get("mode") ?? "region",
          monitor: { id: 0, name: "\\\\.\\DISPLAY1", rect: r(0, 0, 1920, 1080), work: r(0, 0, 1920, 1032), scale: 1.5, primary: true },
          windows: [
            { hwnd: 1, rect: r(160, 120, 900, 600), title: "Algorithco Team", app: "Telegram", class: "Qt" },
            { hwnd: 2, rect: r(980, 300, 760, 520), title: "capture.rs — algorithco-shot", app: "Code", class: "Chrome_WidgetWin_1" },
            { hwnd: 3, rect: r(0, 1032, 1920, 48), title: "", app: "explorer", class: "Shell_TrayWnd" },
            { hwnd: 4, rect: r(0, 0, 1920, 1080), title: "Program Manager", app: "explorer", class: "Progman" },
          ],
          cursor: [Math.round(700 * sx), Math.round(400 * sy)],
          last: null,
          snap: true,
          highlight: params.get("highlight") === "1",
          elements: true,
        }),
      300,
    );
  }
  if (label === "card") {
    const kind = params.get("kind") ?? "shot";
    const card = SAMPLE_CARDS[kind] ?? SAMPLE_CARDS.shot;
    if (card.kind === "shot" && kind === "shot") card.shot = { ...makeShots(2)[1], privacy: 2 };
    setTimeout(() => emit("card:show", card), 300);
  }
}

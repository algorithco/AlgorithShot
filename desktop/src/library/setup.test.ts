import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/api";
import { commitSetup, duplicateShortcuts, needsSetup, SETUP_VERSION, setupDraft, setupFilename, validateSetup } from "./setup";

const initial: Settings = {
  language: "uz", theme: "dark", saveDir: "", saveAll: true,
  filePattern: "{app} {date} {time}", format: "png", jpegQuality: 90, webpQuality: 90,
  copyAfterCapture: true, showCard: true, openEditor: false, cardSeconds: 6,
  snap: true, highlight: false, elements: true, launchAtLogin: false, indexText: true, privacyCheck: true,
  autoCleanDays: 0, sound: false, welcomeDone: false, setupVersion: 0,
  hotkeys: { capture: "PrintScreen", captureAlt: "Ctrl+Shift+PrintScreen", text: "", qr: "", fullScreen: "", repeat: "", library: "" },
};

describe("guided setup", () => {
  it("requires setup for fresh installs and older welcome-only preferences", () => {
    expect(needsSetup(null)).toBe(true);
    expect(needsSetup({})).toBe(true);
    expect(needsSetup({ setupVersion: 0 })).toBe(true);
    expect(needsSetup({ setupVersion: SETUP_VERSION })).toBe(false);
    expect(needsSetup({ setupVersion: SETUP_VERSION + 1 })).toBe(false);
  });

  it("keeps unsaved draft edits separate from the user's preferences", () => {
    const draft = setupDraft(initial);
    draft.hotkeys.capture = "Ctrl+Shift+KeyS";
    draft.language = "ru";
    expect(initial.hotkeys.capture).toBe("PrintScreen");
    expect(initial.language).toBe("uz");
    expect(draft.setupVersion).toBe(0);
  });

  it("finds duplicate shortcuts regardless of modifier order, case, or key aliases", () => {
    const draft = setupDraft(initial);
    draft.hotkeys.capture = "Ctrl+Shift+KeyS";
    draft.hotkeys.text = "shift+CONTROL+s";
    expect(duplicateShortcuts(draft.hotkeys)).toEqual(["shift+CONTROL+s"]);
    expect(validateSetup(draft)).toEqual([{ step: "capture", key: "setup.duplicateKeys" }]);
  });

  it("allows mouse-only capture and empty optional shortcuts", () => {
    const draft = setupDraft(initial);
    draft.hotkeys.capture = "";
    draft.hotkeys.captureAlt = "";
    expect(validateSetup(draft)).toEqual([]);
  });

  it("points an empty naming pattern back to saving preferences", () => {
    expect(validateSetup({ ...initial, filePattern: "   " })).toEqual([{ step: "saving", key: "setup.patternRequired" }]);
  });

  it("previews repeated tokens and the same Windows-safe filename as the backend", () => {
    const now = new Date(2026, 9, 23, 14, 5, 12);
    expect(setupFilename({ ...initial, filePattern: "<{app}>: {date}/{time} {app}", format: "jpeg" }, now))
      .toBe("Telegram 2026-10-23 14-05-12 Telegram.jpg");
    expect(setupFilename({ ...initial, filePattern: "CON..." }, now)).toBe("CON_.png");
    expect(setupFilename({ ...initial, filePattern: "   " }, now)).toBe("Screenshot 2026-10-23 14-05-12.png");
  });

  it("keeps the filename preview within the backend's Unicode length limit", () => {
    const filename = setupFilename({ ...initial, filePattern: "📷".repeat(160) });
    expect([...filename.replace(/\.png$/, "")]).toHaveLength(150);
  });

  it("saves all choices and the completion marker together", async () => {
    const draft = { ...setupDraft(initial), filePattern: "  {title} {date}  ", format: "webp" as const, webpQuality: 73, autoCleanDays: 45 };
    const save = vi.fn(async (settings: Settings) => settings);
    const result = await commitSetup(draft, save);
    expect(save).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ filePattern: "{title} {date}", format: "webp", webpQuality: 73, autoCleanDays: 45, welcomeDone: true, setupVersion: SETUP_VERSION });
    expect(draft.setupVersion).toBe(0);
    expect(draft.welcomeDone).toBe(false);
  });

  it("preserves the entire draft after a failed save so it can be retried", async () => {
    const draft = setupDraft(initial);
    draft.hotkeys.text = "Ctrl+Alt+KeyT";
    draft.saveDir = "D:\\Screenshots";
    const save = vi.fn().mockRejectedValueOnce(new Error("Folder is read-only")).mockImplementationOnce(async (settings: Settings) => settings);
    await expect(commitSetup(draft, save)).rejects.toThrow("Folder is read-only");
    expect(draft.setupVersion).toBe(0);
    expect(draft.hotkeys.text).toBe("Ctrl+Alt+KeyT");
    const retried = await commitSetup(draft, save);
    expect(retried.saveDir).toBe("D:\\Screenshots");
    expect(retried.hotkeys.text).toBe("Ctrl+Alt+KeyT");
    expect(retried.setupVersion).toBe(SETUP_VERSION);
  });

  it("never calls the backend with an invalid setup", async () => {
    const save = vi.fn();
    await expect(commitSetup({ ...initial, filePattern: " " }, save)).rejects.toThrow("Invalid setup choices");
    expect(save).not.toHaveBeenCalled();
  });
});

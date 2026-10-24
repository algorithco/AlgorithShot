import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./api";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn(), listen: vi.fn() }));
vi.mock("./api", () => ({ api: { getSettings: mocks.getSettings, saveSettings: mocks.saveSettings } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

describe("settings initialization recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSettings.mockReset().mockResolvedValue({ language: "uz", theme: "dark" });
    mocks.listen.mockReset();
    mocks.saveSettings.mockReset();
  });

  it("restores cross-window updates after a failed startup subscription", async () => {
    mocks.listen.mockRejectedValueOnce(new Error("Event bridge unavailable")).mockResolvedValueOnce(() => {});
    const { initSettings, useSettings } = await import("./settings");
    await expect(initSettings()).rejects.toThrow("Event bridge unavailable");
    await initSettings();
    const receive = mocks.listen.mock.calls[1][1] as (event: { payload: Settings }) => void;
    const changed = { language: "ru", theme: "light" } as Settings;
    receive({ payload: changed });
    expect(useSettings.getState().settings).toEqual(changed);
    expect(mocks.listen).toHaveBeenCalledTimes(2);
  });

  it("shares one event subscription when initialization attempts overlap", async () => {
    let subscribed!: (unlisten: () => void) => void;
    mocks.listen.mockReturnValue(new Promise<() => void>((resolve) => { subscribed = resolve; }));
    const { initSettings } = await import("./settings");
    const first = initSettings();
    const second = initSettings();
    subscribed(() => {});
    await Promise.all([first, second]);
    expect(mocks.listen).toHaveBeenCalledOnce();
  });

  it("does not mark setup complete in the shared store when persistence fails", async () => {
    const { useSettings } = await import("./settings");
    const current = { language: "uz", theme: "dark", hotkeys: { capture: "PrintScreen" }, setupVersion: 0, welcomeDone: false } as Settings;
    useSettings.setState({ settings: current });
    mocks.saveSettings.mockRejectedValue(new Error("Preferences could not be saved"));
    await expect(useSettings.getState().update({ setupVersion: 1, welcomeDone: true })).rejects.toThrow("Preferences could not be saved");
    expect(useSettings.getState().settings).toEqual(current);
  });
});

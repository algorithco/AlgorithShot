import { describe, expect, it, vi } from "vitest";
import { createUpdateStore } from "../library/updates";

describe("recording/update interlock", () => {
  function setup() {
    const update = { version: "1.0.0", downloadAndInstall: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const beforeInstall = vi.fn(async () => {});
    const afterInstall = vi.fn(async () => {});
    const restart = vi.fn(async () => {});
    const store = createUpdateStore({ check: async () => update, restart, beforeInstall, afterInstall });
    return { update, beforeInstall, afterInstall, restart, store };
  }

  it("never launches the installer while a recording owns the native lock", async () => {
    const { store, update, restart, beforeInstall, afterInstall } = setup();
    beforeInstall.mockRejectedValueOnce(new Error("Stop and save the recording first."));
    await store.getState().check();
    await store.getState().install();
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toContain("Stop and save");
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(0);
    expect(restart).toHaveBeenCalledTimes(0);
    expect(afterInstall).toHaveBeenCalledTimes(0);
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(afterInstall).toHaveBeenCalledOnce();
  });

  it("releases the recording lock when installation fails", async () => {
    const { store, update, beforeInstall, afterInstall, restart } = setup();
    update.downloadAndInstall.mockRejectedValueOnce(new Error("Download failed"));
    await store.getState().check();
    await store.getState().install();
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(afterInstall).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(0);
    expect(store.getState().status).toBe("error");
  });

  it("keeps the native lock through installer and relaunch", async () => {
    const { store, update, beforeInstall, afterInstall, restart } = setup();
    update.downloadAndInstall.mockImplementation(async () => {
      expect(beforeInstall).toHaveBeenCalledOnce();
      expect(afterInstall).toHaveBeenCalledTimes(0);
    });
    restart.mockImplementation(async () => { expect(afterInstall).toHaveBeenCalledTimes(0); });
    await store.getState().check();
    await store.getState().install();
    expect(restart).toHaveBeenCalledOnce();
    expect(afterInstall).toHaveBeenCalledOnce();
  });
});

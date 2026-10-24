import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { createUpdateStore, startUpdateChecks } from "./updates";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const update = {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async (_onProgress?: (event: DownloadEvent) => void, _options?: { timeout?: number }) => {}),
    close: vi.fn(async () => {}),
  };
  const check = vi.fn(async (): Promise<typeof update | null> => update);
  const restart = vi.fn(async () => {});
  const store = createUpdateStore({ check, restart });
  return { update, check, restart, store };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("in-app updates", () => {
  it("announces a newer version without downloading or installing it", async () => {
    const { store, update } = setup();
    await store.getState().check();
    expect(store.getState()).toMatchObject({ status: "available", version: "0.2.0" });
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("keeps the banner hidden when the updater finds no newer release", async () => {
    const { store, check, update } = setup();
    check.mockResolvedValue(null);
    await store.getState().check();
    await store.getState().install();
    expect(store.getState()).toMatchObject({ status: "idle", version: null });
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("shares a pending check across startup and focus events", async () => {
    const { store, check, update } = setup();
    const result = deferred<typeof update | null>();
    check.mockReturnValue(result.promise);
    const first = store.getState().check();
    await store.getState().check();
    expect(check).toHaveBeenCalledOnce();
    expect(store.getState().status).toBe("checking");
    result.resolve(update);
    await first;
    expect(store.getState().status).toBe("available");
  });

  it("silently recovers from an offline startup check", async () => {
    const { store, check } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    check.mockRejectedValueOnce(new Error("Offline"));
    await store.getState().check();
    expect(store.getState()).toMatchObject({ status: "idle", version: null, error: null });
    await store.getState().check();
    expect(store.getState().status).toBe("available");
  });

  it("keeps the available native resource until the user chooses to install", async () => {
    const { store, check, update } = setup();
    await store.getState().check();
    await store.getState().check();
    expect(check).toHaveBeenCalledOnce();
    expect(update.close).not.toHaveBeenCalled();
  });

  it("tracks chunks, prevents duplicate clicks, and restarts after installation", async () => {
    const { store, update, restart } = setup();
    const installed = deferred<void>();
    let progress!: (event: DownloadEvent) => void;
    update.downloadAndInstall.mockImplementation((receive) => {
      progress = receive!;
      return installed.promise;
    });
    await store.getState().check();
    const install = store.getState().install();
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();

    progress({ event: "Started", data: { contentLength: 1000 } });
    progress({ event: "Progress", data: { chunkLength: 120 } });
    progress({ event: "Progress", data: { chunkLength: 380 } });
    expect(store.getState()).toMatchObject({ status: "downloading", downloaded: 500, total: 1000 });
    progress({ event: "Finished" });
    expect(store.getState().status).toBe("installing");
    expect(restart).not.toHaveBeenCalled();

    installed.resolve();
    await install;
    expect(store.getState()).toMatchObject({ status: "restarting", installed: true });
    expect(update.close).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
  });

  it("handles missing or zero content lengths without inventing a percentage", async () => {
    const { store, update } = setup();
    update.downloadAndInstall.mockImplementation(async (receive) => {
      receive!({ event: "Started", data: {} });
      receive!({ event: "Progress", data: { chunkLength: 1024 } });
      expect(store.getState()).toMatchObject({ downloaded: 1024, total: null });
      receive!({ event: "Started", data: { contentLength: 0 } });
      expect(store.getState()).toMatchObject({ downloaded: 0, total: null });
    });
    await store.getState().check();
    await store.getState().install();
  });

  it("allows retry after a download or signature failure without restarting", async () => {
    const { store, update, restart } = setup();
    update.downloadAndInstall.mockRejectedValueOnce(new Error("Signature verification failed"));
    await store.getState().check();
    await store.getState().install();
    expect(store.getState()).toMatchObject({ status: "error", installed: false, error: "Signature verification failed" });
    expect(restart).not.toHaveBeenCalled();
    expect(update.close).not.toHaveBeenCalled();
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ status: "restarting", error: null });
  });

  it("retries only the restart when installation has already succeeded", async () => {
    const { store, update, restart } = setup();
    restart.mockRejectedValueOnce(new Error("Restart failed"));
    await store.getState().check();
    await store.getState().install();
    expect(store.getState()).toMatchObject({ status: "error", installed: true });
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({ status: "restarting", error: null });
  });

  it("does not let a periodic check interrupt the download", async () => {
    const { store, check, update } = setup();
    const installed = deferred<void>();
    update.downloadAndInstall.mockReturnValue(installed.promise);
    await store.getState().check();
    const install = store.getState().install();
    await store.getState().check();
    expect(check).toHaveBeenCalledOnce();
    expect(store.getState().status).toBe("downloading");
    installed.resolve();
    await install;
  });
});

describe("update check schedule", () => {
  function browser() {
    vi.useFakeTimers();
    const host = Object.assign(new EventTarget(), { setInterval, clearInterval });
    const doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("window", host);
    vi.stubGlobal("document", doc);
    const test = setup();
    test.check.mockResolvedValue(null);
    return { ...test, host, doc };
  }

  it("checks immediately, throttles focus, and retries immediately when online", async () => {
    const { store, check, host, doc } = browser();
    const stop = startUpdateChecks(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event("focus"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    host.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    host.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
  });

  it("checks every 15 minutes and removes timers and listeners on cleanup", async () => {
    const { store, check, host, doc } = browser();
    const stop = startUpdateChecks(store);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    host.dispatchEvent(new Event("focus"));
    host.dispatchEvent(new Event("online"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks when becoming visible, but skips visibility events while hidden", async () => {
    const { store, check, doc } = browser();
    const stop = startUpdateChecks(store);
    await vi.advanceTimersByTimeAsync(60_000);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(check).toHaveBeenCalledOnce();
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareStartup, StartupTimeoutError, type StartupStage } from "./startup";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides: Partial<Parameters<typeof prepareStartup>[0]> = {}) {
  const controller = new AbortController();
  const stages: StartupStage[] = [];
  const loadSettings = vi.fn(async () => {});
  const loadLibrary = vi.fn(async () => {});
  const options = {
    loadSettings,
    loadLibrary,
    shouldLoadLibrary: () => true,
    onStage: (stage: StartupStage) => stages.push(stage),
    signal: controller.signal,
    ...overrides,
  };
  return { controller, stages, loadSettings, loadLibrary, options };
}

describe("main window startup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads preferences before the library and runs the introduction concurrently", async () => {
    const settings = deferred();
    const library = deferred();
    const test = setup({ loadSettings: () => settings.promise, loadLibrary: () => library.promise });
    let ready = false;
    const pending = prepareStartup(test.options).then(() => { ready = true; });
    expect(test.stages).toEqual(["settings"]);
    settings.resolve();
    await vi.advanceTimersByTimeAsync(400);
    expect(test.stages).toEqual(["settings", "workspace"]);
    expect(ready).toBe(false);
    library.resolve();
    await vi.advanceTimersByTimeAsync(3099);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never reveals the app before actual library readiness", async () => {
    const library = deferred();
    const test = setup({ loadLibrary: () => library.promise });
    let ready = false;
    const pending = prepareStartup(test.options).then(() => { ready = true; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ready).toBe(false);
    library.resolve();
    await pending;
    expect(ready).toBe(true);
  });

  it("skips library prefetch for welcome, settings, and cleanup destinations", async () => {
    const test = setup({ shouldLoadLibrary: () => false, minimumMs: 0 });
    const pending = prepareStartup(test.options);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(test.loadSettings).toHaveBeenCalledOnce();
    expect(test.loadLibrary).not.toHaveBeenCalled();
  });

  it("does not delay reduced-motion startup for the introduction", async () => {
    const test = setup({ minimumMs: 0 });
    const pending = prepareStartup(test.options);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces a failed backend request and allows a fresh successful attempt", async () => {
    const test = setup();
    const failed = prepareStartup({ ...test.options, loadLibrary: async () => { throw new Error("Library unavailable"); } });
    await expect(failed).rejects.toThrow("Library unavailable");
    expect(vi.getTimerCount()).toBe(0);
    const retry = prepareStartup(test.options);
    await vi.advanceTimersByTimeAsync(3500);
    await retry;
    expect(test.loadLibrary).toHaveBeenCalledOnce();
  });

  it("does not touch the library when preferences fail to load", async () => {
    const test = setup({ loadSettings: async () => { throw new Error("Settings unavailable"); } });
    await expect(prepareStartup(test.options)).rejects.toThrow("Settings unavailable");
    expect(test.loadLibrary).not.toHaveBeenCalled();
    expect(test.stages).toEqual(["settings"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a timed-out attempt from starting later backend work", async () => {
    const settings = deferred();
    const test = setup({ loadSettings: () => settings.promise });
    const pending = prepareStartup(test.options);
    const rejection = expect(pending).rejects.toBeInstanceOf(StartupTimeoutError);
    await vi.advanceTimersByTimeAsync(15000);
    await rejection;
    settings.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.loadLibrary).not.toHaveBeenCalled();
    expect(test.stages).toEqual(["settings"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up an unmounted attempt and ignores its stale completion", async () => {
    const settings = deferred();
    const test = setup({ loadSettings: () => settings.promise });
    const pending = prepareStartup(test.options);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    test.controller.abort();
    await rejection;
    settings.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.loadLibrary).not.toHaveBeenCalled();
    expect(test.stages).toEqual(["settings"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start work with an already aborted signal", async () => {
    const test = setup();
    test.controller.abort();
    await expect(prepareStartup(test.options)).rejects.toMatchObject({ name: "AbortError" });
    expect(test.loadSettings).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

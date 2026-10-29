import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, RefObject } from "react";
import { Overlay } from "./Overlay";

const fixture = {
  sessionId: 7, mode: "region", monitor: { id: 0, name: "Display", rect: { x: 0, y: 0, w: 2, h: 2 },
    work: { x: 0, y: 0, w: 2, h: 2 }, scale: 1, primary: true },
  windows: [], cursor: null, last: null, snap: true, highlight: false, elements: false,
};
const mock = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  listeners: new Map<string, (event: { payload: unknown }) => Promise<void>>(),
  loaded: vi.fn(), ready: vi.fn(), failed: vi.fn(), cancel: vi.fn(), draw: vi.fn(),
}));

vi.mock("react", async (original: <T>() => Promise<T>) => ({
  ...await original<typeof import("react")>(),
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { mock.effects.push(effect); },
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, vi.fn()],
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => Promise<void>) => {
    mock.listeners.set(name, handler);
    return Promise.resolve(vi.fn());
  }),
}));
vi.mock("../shared/api", () => ({
  api: { overlayLoaded: mock.loaded, overlayReady: mock.ready, overlayFailed: mock.failed, captureCancel: mock.cancel },
  errorText: (error: unknown) => String(error), shotUrl: (path: string) => `shot://localhost/${path}`,
}));
vi.mock("../shared/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../shared/settings", () => ({ initSettings: vi.fn() }));
vi.mock("./engine", () => ({ Engine: class {
  load = mock.draw;
  clear = vi.fn();
  setMode = vi.fn();
} }));

let cleanup: Array<() => void>;
beforeEach(() => {
  vi.clearAllMocks();
  mock.effects.length = 0;
  mock.listeners.clear();
  mock.loaded.mockResolvedValue(undefined);
  mock.ready.mockResolvedValue(undefined);
  mock.failed.mockResolvedValue(undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // Reproduces the scheduling contract of a hidden WebKit window: no rAF runs.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(16), { headers: { "content-type": "application/octet-stream" } })));
  const root = Overlay();
  const children = (root.props as { children: ReactElement[] }).children;
  const canvas = children.find((child) => child?.type === "canvas") as ReactElement<{ ref: RefObject<unknown> }>;
  canvas.props.ref.current = {};
  cleanup = mock.effects.map((effect) => effect()).filter((effect): effect is () => void => typeof effect === "function");
});
afterEach(() => {
  cleanup.forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hidden capture window startup", () => {
  it("subscribes before declaring readiness and shows a prepared frame without any animation callback", async () => {
    await vi.waitFor(() => expect(mock.loaded).toHaveBeenCalledOnce());
    expect(mock.listeners.has("overlay:start")).toBe(true);
    await mock.listeners.get("overlay:start")!({ payload: fixture });
    expect(mock.draw).toHaveBeenCalledOnce();
    expect(mock.ready).toHaveBeenCalledWith(7, 0);
    expect(mock.failed).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("reports a failed frame to the native UI instead of cancelling silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await mock.listeners.get("overlay:start")!({ payload: fixture });
    expect(mock.failed).toHaveBeenCalledWith(7, expect.stringContaining("frame 500"));
    expect(mock.ready).not.toHaveBeenCalled();
    expect(mock.cancel).not.toHaveBeenCalled();
  });
});

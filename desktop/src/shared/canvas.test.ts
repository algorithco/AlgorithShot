import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "./canvas";

afterEach(() => vi.unstubAllGlobals());

describe("system WebKit raster compatibility", () => {
  it("draws on a DOM canvas when OffscreenCanvas is unavailable", () => {
    const fallback = { width: 0, height: 0 };
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.stubGlobal("document", { createElement: vi.fn(() => fallback) });
    expect(createCanvas(200.4, 100.6)).toBe(fallback);
    expect(fallback).toEqual({ width: 200, height: 101 });
  });

  it("falls back when the exposed offscreen implementation has no 2D context", () => {
    const fallback = {};
    vi.stubGlobal("OffscreenCanvas", class { getContext() { return null; } });
    vi.stubGlobal("document", { createElement: () => fallback });
    expect(createCanvas(12, 8)).toBe(fallback);
  });

  it("keeps a working offscreen surface", () => {
    class WorkingCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return {}; }
    }
    vi.stubGlobal("OffscreenCanvas", WorkingCanvas);
    expect(createCanvas(12, 8)).toBeInstanceOf(WorkingCanvas);
  });
});

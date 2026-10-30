import { afterEach, expect, it, vi } from "vitest";
import { Engine, type Callbacks } from "./engine";

afterEach(() => vi.unstubAllGlobals());

it("keeps a portrait portal image square and crops the correct pixels after the compositor resizes its window", () => {
  const viewport = { innerWidth: 800, innerHeight: 400 };
  vi.stubGlobal("window", viewport);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  const context = new Proxy({}, { get: () => vi.fn() });
  const canvas = { getContext: () => context, style: {}, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
  const cb: Callbacks = { change: vi.fn(), commit: vi.fn(), cancel: vi.fn(), color: vi.fn(), readText: vi.fn(), copyText: vi.fn() };
  const engine = new Engine(canvas as unknown as HTMLCanvasElement, cb);
  engine.load({ bitmap: { close: vi.fn() } as unknown as ImageBitmap, pixels: new Uint8ClampedArray(100 * 200 * 4),
    width: 100, height: 200, mode: "region", windows: [], cursor: null, snap: false, highlight: false });
  expect(canvas.style).toMatchObject({ width: "200px", height: "400px" });
  const point = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1, ctrlKey: true } as PointerEvent);
  engine.down(point(20, 30));
  engine.move(point(80, 200));
  expect(engine.sel).toEqual({ x: 10, y: 15, w: 30, h: 85 });
  viewport.innerWidth = 400;
  viewport.innerHeight = 800;
  engine.fitViewport();
  expect(canvas.style).toMatchObject({ width: "400px", height: "800px" });
  expect(engine.sel).toEqual({ x: 10, y: 15, w: 30, h: 85 });
  expect(engine.ratio).toBe(0.25);
});

import { describe, expect, it, vi } from "vitest";
import type { Mark, Op } from "./doc";
import { BaseRenderer, drawMark, markBounds } from "./render";

function context() {
  const rendered: { alpha: number; width: number; color: string }[] = [];
  const ctx = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "#000",
    fillStyle: "#000",
    lineCap: "butt",
    lineJoin: "miter",
    shadowColor: "transparent",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
    arc: vi.fn(), rect: vi.fn(), ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(() => rendered.push({ alpha: ctx.globalAlpha, width: ctx.lineWidth, color: ctx.strokeStyle })),
  };
  return { ctx, rendered, canvas: ctx as unknown as CanvasRenderingContext2D };
}

describe("paint rendering", () => {
  const stroke: Mark = {
    id: "ink", kind: "stroke", tool: "marker", color: "#24A1EF", width: 20, opacity: 0.35,
    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }],
  };

  it("paints translucent marker ink as one path, including at self intersections", () => {
    const { ctx, canvas, rendered } = context();
    drawMark(canvas, stroke);
    expect(rendered).toEqual([{ alpha: 0.35, width: 20, color: "#24A1EF" }]);
    expect(ctx.lineCap).toBe("round");
    expect(ctx.lineJoin).toBe("round");
    expect(ctx.shadowColor).toBe("transparent");
    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenLastCalledWith(100, 0);
  });

  it("keeps pencil samples precise and paints taps as dots", () => {
    const pencil = context();
    drawMark(pencil.canvas, { ...stroke, tool: "pencil" });
    expect(pencil.ctx.quadraticCurveTo.mock.calls).toEqual([]);
    expect(pencil.ctx.lineTo).toHaveBeenCalledTimes(3);
    const dot = context();
    drawMark(dot.canvas, { ...stroke, points: [{ x: 17, y: 24 }] });
    expect(dot.ctx.arc).toHaveBeenCalledWith(17, 24, 10, 0, Math.PI * 2);
    expect(dot.ctx.fill).toHaveBeenCalledOnce();
    expect(dot.ctx.stroke.mock.calls).toEqual([]);
    const empty = context();
    drawMark(empty.canvas, { ...stroke, points: [] });
    expect(empty.ctx.stroke.mock.calls).toEqual([]);
    expect(empty.ctx.fill.mock.calls).toEqual([]);
  });

  it("honors shape fill and opacity without adding paint shadows", () => {
    const { ctx, canvas } = context();
    drawMark(canvas, { id: "oval", kind: "ellipse", rect: { x: 10, y: 20, w: 80, h: 40 }, color: "#ABCDEF", width: 6, opacity: 0.6, fill: true });
    expect(ctx.ellipse).toHaveBeenCalledWith(50, 40, 40, 20, 0, 0, Math.PI * 2);
    expect(ctx.globalAlpha).toBe(0.6);
    expect(ctx.fillStyle).toBe("#ABCDEF");
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.stroke.mock.calls).toEqual([]);
    expect(ctx.shadowColor).toBe("transparent");
  });

  it("includes brush width in selection bounds, including dots and long strokes", () => {
    expect(markBounds({ ...stroke, points: [{ x: 10, y: 20 }] })).toEqual({ x: 0, y: 10, w: 20, h: 20 });
    const points = Array.from({ length: 150_000 }, (_, i) => ({ x: i, y: i % 100 }));
    expect(markBounds({ ...stroke, points })).toEqual({ x: -10, y: -10, w: 150_019, h: 119 });
  });
});

// Raster snapshots carry an edit trace, allowing cache replay to be checked
// without depending on browser canvas APIs or allocating large pixel buffers.
class RasterCanvas {
  trace: string[] = [];
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      drawImage: (source: { trace: string[] }) => { this.trace = source.trace.slice(); },
      clearRect: (x: number, y: number, w: number, h: number) => { this.trace.push(`erase:${x},${y},${w},${h}`); },
    };
  }
}

function rasterTest(run: () => void) {
  vi.stubGlobal("OffscreenCanvas", RasterCanvas);
  try { run(); } finally { vi.unstubAllGlobals(); }
}

const bitmap = (width: number, height: number) => ({ width, height, trace: ["original"] }) as unknown as ImageBitmap;
const erases = (count: number): Op[] => Array.from({ length: count }, (_, x) => ({ kind: "erase", rect: { x, y: 1, w: 1, h: 1 } }));
const traceOf = (canvas: OffscreenCanvas) => (canvas as unknown as RasterCanvas).trace;
const cacheOf = (renderer: BaseRenderer) => (renderer as unknown as { cache: Map<number, { canvas: OffscreenCanvas }>; cachedBytes: number });

describe("raster history cache", () => {
  it("bounds retained bytes during long sessions and replay, preserving original and current", () => rasterTest(() => {
    const renderer = new BaseRenderer(bitmap(100, 100), 3 * 100 * 100 * 4);
    const ops = erases(200);
    const current = renderer.render(ops);
    const { cache, cachedBytes } = cacheOf(renderer);
    expect(cachedBytes).toBe(120_000);
    expect(cache.size).toBe(3);
    expect(cache.has(0)).toBe(true);
    expect(cache.get(200)?.canvas).toBe(current);
    expect(traceOf(current)).toHaveLength(201);
    const undone = renderer.render(ops.slice(0, 25));
    expect(traceOf(undone)).toEqual(["original", ...ops.slice(0, 25).map((_, x) => `erase:${x},1,1,1`)]);
    expect(cacheOf(renderer).cachedBytes).toBe(120_000);
    expect(traceOf(renderer.render(ops))).toEqual(traceOf(current));
    expect(cacheOf(renderer).cachedBytes).toBe(120_000);
  }));

  it("keeps fast repeat renders and recent undo snapshots when they fit", () => rasterTest(() => {
    const renderer = new BaseRenderer(bitmap(10, 10), 100_000);
    const ops = erases(4);
    const current = renderer.render(ops);
    const recent = cacheOf(renderer).cache.get(3)!.canvas;
    expect(renderer.render(ops)).toBe(current);
    expect(renderer.render(ops.slice(0, 3))).toBe(recent);
  }));

  it("discards replaced branches without replaying stale edits", () => rasterTest(() => {
    const renderer = new BaseRenderer(bitmap(10, 10), 100_000);
    const ops = erases(5);
    renderer.render(ops);
    const branch: Op[] = [...ops.slice(0, 2), { kind: "erase", rect: { x: 99, y: 2, w: 3, h: 4 } }];
    expect(traceOf(renderer.render(branch))).toEqual(["original", "erase:0,1,1,1", "erase:1,1,1,1", "erase:99,2,3,4"]);
    expect([...cacheOf(renderer).cache.keys()]).toEqual([0, 1, 2, 3]);
    expect(traceOf(renderer.render([]))).toEqual(["original"]);
    expect(cacheOf(renderer).cache.size).toBe(1);
  }));

  it("accounts for changing image sizes and the unavoidable original/current pair", () => rasterTest(() => {
    const renderer = new BaseRenderer(bitmap(100, 100), 45_000);
    const ops: Op[] = [{ kind: "crop", rect: { x: 0, y: 0, w: 10, h: 10 } }, ...erases(20)];
    renderer.render(ops);
    expect(cacheOf(renderer).cachedBytes).toBeLessThanOrEqual(45_000);
    expect(cacheOf(renderer).cache.size).toBeLessThanOrEqual(12);
    const oversized = new BaseRenderer(bitmap(100, 100), 1);
    const current = oversized.render(erases(20));
    expect(cacheOf(oversized).cache.size).toBe(2);
    expect(cacheOf(oversized).cache.get(20)?.canvas).toBe(current);
    expect(cacheOf(oversized).cachedBytes).toBe(80_000);
  }));
});

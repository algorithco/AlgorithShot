import { describe, expect, it } from "vitest";
import type { Rect } from "../shared/api";
import type { Handle } from "../shared/geometry";
import { dragCrop, fitCrop, sizeCrop } from "./crop";

const bounds = { w: 800, h: 600 };
const orig = { x: 100, y: 100, w: 200, h: 100 };
const start = { x: 100, y: 100 };

function inside(rect: Rect, image = bounds) {
  expect(Object.values(rect).every(Number.isInteger)).toBe(true);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.w).toBeGreaterThanOrEqual(1);
  expect(rect.h).toBeGreaterThanOrEqual(1);
  expect(rect.x + rect.w).toBeLessThanOrEqual(image.w);
  expect(rect.y + rect.h).toBeLessThanOrEqual(image.h);
}

describe("crop sizing", () => {
  it("fits around the original center and constrains both edges", () => {
    expect(fitCrop({ x: 100, y: 100, w: 400, h: 200 }, bounds, 1)).toEqual({ x: 200, y: 100, w: 200, h: 200 });
    expect(fitCrop({ x: 799, y: 599, w: 1000, h: 1000 }, bounds, 1)).toEqual({ x: 200, y: 0, w: 600, h: 600 });
  });

  it("keeps numeric edits inside the image when the crop starts near an edge", () => {
    expect(sizeCrop({ x: 700, y: 550, w: 50, h: 40 }, 300, "w", bounds)).toEqual({ x: 500, y: 550, w: 300, h: 40 });
    expect(sizeCrop(orig, 1200, "w", bounds, 2)).toEqual({ x: 0, y: 100, w: 800, h: 400 });
    expect(sizeCrop(orig, 600, "h", bounds, 2)).toEqual({ x: 0, y: 100, w: 800, h: 400 });
  });

  it("retains dimensions and origin after fitting an already rounded ratio", () => {
    const rect = sizeCrop({ x: 682, y: 534, w: 100, h: 50 }, 118, "w", bounds, 16 / 9);
    expect(rect).toEqual({ x: 682, y: 534, w: 118, h: 66 });
    expect(fitCrop(rect, bounds, 16 / 9)).toEqual(rect);
    expect(fitCrop(fitCrop(rect, bounds, 16 / 9), bounds, 16 / 9)).toEqual(rect);
  });

  it("fits tiny and large fixed-ratio crops idempotently", () => {
    for (const ratio of [1, 4 / 3, 16 / 9, 9 / 16, 3 / 2, 0.000001, 1000000]) {
      for (const size of [1, 2, 3, 7, 16, 65, 66, 117, 118, 127, 200, 599, 600, 799, 800, 1200]) {
        for (const axis of ["w", "h"] as const) {
          const sized = sizeCrop({ x: 700, y: 550, w: 80, h: 40 }, size, axis, bounds, ratio);
          const fitted = fitCrop(sized, bounds, ratio);
          inside(fitted);
          expect(fitted).toEqual(sized);
          expect(fitCrop(fitted, bounds, ratio)).toEqual(fitted);
        }
        const fitted = fitCrop({ x: 777, y: -11, w: size, h: 600 }, bounds, ratio);
        expect(fitCrop(fitted, bounds, ratio)).toEqual(fitted);
      }
    }
  });

  it("never emits empty dimensions for zero, invalid, or extreme ratios", () => {
    for (const ratio of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.000001, 1000000]) {
      inside(fitCrop({ x: -10, y: 900, w: 0, h: -5 }, bounds, ratio));
      inside(sizeCrop(orig, Number.NaN, "w", bounds, ratio));
    }
    expect(fitCrop({ x: 0, y: 0, w: 800, h: 600 }, bounds, 1000000)).toMatchObject({ w: 800, h: 1 });
    expect(fitCrop({ x: 0, y: 0, w: 800, h: 600 }, bounds, 0.000001)).toMatchObject({ w: 1, h: 600 });
  });
});

describe("crop gestures", () => {
  it("creates a crop in every direction from the initial pointer", () => {
    expect(dragCrop(orig, "new", start, { x: 220, y: 180 }, bounds, null)).toEqual({ x: 100, y: 100, w: 120, h: 80 });
    expect(dragCrop(orig, "new", start, { x: 20, y: 40 }, bounds, null)).toEqual({ x: 20, y: 40, w: 80, h: 60 });
    expect(dragCrop(orig, "new", start, { x: 220, y: 40 }, bounds, null)).toEqual({ x: 100, y: 40, w: 120, h: 60 });
    expect(dragCrop(orig, "new", start, { x: 20, y: 180 }, bounds, null)).toEqual({ x: 20, y: 100, w: 80, h: 80 });
  });

  it("limits fixed ratios against both image edges", () => {
    expect(dragCrop(orig, "new", { x: 700, y: 500 }, { x: 1500, y: 1500 }, bounds, 2)).toEqual({ x: 700, y: 500, w: 100, h: 50 });
    expect(dragCrop(orig, "new", { x: 100, y: 100 }, { x: -500, y: -500 }, bounds, 2)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });

  it("holds the opposite corner in place, including crossing it", () => {
    expect(dragCrop(orig, "nw", start, { x: 20, y: 40 }, bounds, 2)).toEqual({ x: 0, y: 50, w: 300, h: 150 });
    expect(dragCrop(orig, "se", start, { x: 50, y: 50 }, bounds, 2)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
    expect(dragCrop(orig, "w", start, { x: 350, y: 0 }, bounds, null)).toEqual({ x: 300, y: 100, w: 50, h: 100 });
  });

  it("centers the perpendicular dimension when resizing a ratio from a side", () => {
    expect(dragCrop(orig, "e", start, { x: 500, y: 0 }, bounds, 2)).toEqual({ x: 100, y: 50, w: 400, h: 200 });
    expect(dragCrop(orig, "s", start, { x: 0, y: 300 }, bounds, 2)).toEqual({ x: 0, y: 100, w: 400, h: 200 });
    expect(dragCrop(orig, "e", start, { x: 800, y: 0 }, bounds, 2)).toEqual({ x: 100, y: 0, w: 600, h: 300 });
  });

  it("moves a crop without resizing it", () => {
    expect(dragCrop(orig, "move", start, { x: 900, y: -100 }, bounds, 2)).toEqual({ x: 600, y: 0, w: 200, h: 100 });
  });

  it("keeps every handle valid for zero-sized and out-of-bounds gestures", () => {
    const handles: (Handle | "new")[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w", "new"];
    for (const mode of handles) {
      for (const point of [{ x: 0, y: 0 }, { x: 800, y: 600 }, start, { x: -200, y: 999 }]) {
        for (const ratio of [null, 1, 16 / 9, 9 / 16]) {
          const rect = dragCrop(orig, mode, start, point, bounds, ratio);
          inside(rect);
          if (ratio) expect(Math.abs(rect.w - rect.h * ratio)).toBeLessThanOrEqual(Math.max(1, ratio));
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { contains, edges, frameAt, fromPoints, grow, handleAt, intersect, keepInside, resize, snap } from "./geometry";

const screen = { x: 0, y: 0, w: 1920, h: 1080 };

describe("selection geometry", () => {
  it("builds a rect from two drag points in any direction", () => {
    expect(fromPoints({ x: 10, y: 20 }, { x: 110.4, y: 70.6 })).toEqual({ x: 10, y: 20, w: 100, h: 51 });
    expect(fromPoints({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it("makes a square with shift, keeping the drag direction", () => {
    expect(fromPoints({ x: 100, y: 100 }, { x: 150, y: 120 }, true)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
    expect(fromPoints({ x: 100, y: 100 }, { x: 80, y: 40 }, true)).toEqual({ x: 40, y: 40, w: 60, h: 60 });
  });

  it("keeps a moved selection on the screen", () => {
    expect(keepInside({ x: 1900, y: -5, w: 100, h: 50 }, screen)).toEqual({ x: 1820, y: 0, w: 100, h: 50 });
    expect(keepInside({ x: 0, y: 0, w: 3000, h: 10 }, screen).w).toBe(1920);
  });

  it("snaps only within the threshold, to the nearest line", () => {
    expect(snap(103, [100, 105], 4)).toBe(105);
    expect(snap(103, [100], 2)).toBe(103);
    const { xs, ys } = edges([{ x: 5, y: 6, w: 10, h: 20 }]);
    expect(xs).toEqual([5, 15]);
    expect(ys).toEqual([6, 26]);
  });

  it("finds handles and resizes from them", () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(handleAt(r, { x: 101, y: 99 }, 4)).toBe("nw");
    expect(handleAt(r, { x: 300, y: 150 }, 4)).toBe("e");
    expect(handleAt(r, { x: 200, y: 150 }, 4)).toBeNull();
    expect(resize(r, "se", { x: 350, y: 260 })).toEqual({ x: 100, y: 100, w: 250, h: 160 });
    // Dragging the left edge past the right one flips the rect.
    expect(resize(r, "w", { x: 320, y: 0 })).toEqual({ x: 300, y: 100, w: 20, h: 100 });
  });

  it("places fixed-size frames and grows within bounds", () => {
    expect(frameAt({ x: 10, y: 10 }, 1280, 720, screen)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(frameAt({ x: 960, y: 540 }, 100, 100, screen)).toEqual({ x: 910, y: 490, w: 100, h: 100 });
    expect(grow({ x: 1900, y: 0, w: 10, h: 10 }, 50, -20, screen)).toEqual({ x: 1900, y: 0, w: 20, h: 1 });
  });

  it("contains and intersects", () => {
    expect(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9 })).toBe(true);
    expect(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 5 })).toBe(false);
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });
});

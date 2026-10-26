import { describe, expect, it } from "vitest";
import { numericDraft, resizeDimensions } from "./Panels";

describe("editor numeric input", () => {
  it("rounds complete decimal and exponent values instead of concatenating their digits", () => {
    expect(numericDraft("2.5")).toBe(3);
    expect(numericDraft("1e3")).toBe(1000);
    expect(numericDraft("-2")).toBe(1);
    expect(numericDraft("999", 1, 120)).toBe(120);
  });

  it("rejects incomplete values and accepts zero when the field permits it", () => {
    for (const text of ["", " ", "-", "1e", "Infinity", "NaN"]) expect(numericDraft(text)).toBeNull();
    expect(numericDraft("0", 0, 255)).toBe(0);
  });
});

describe("locked image dimensions", () => {
  it("limits both dimensions while retaining a portrait or landscape ratio", () => {
    expect(resizeDimensions({ w: 400, h: 1600 }, 20000, "w", 1 / 4)).toEqual({ w: 5000, h: 20000 });
    expect(resizeDimensions({ w: 1600, h: 400 }, 20000, "h", 4)).toEqual({ w: 20000, h: 5000 });
  });

  it("updates only the requested dimension when proportions are unlocked", () => {
    expect(resizeDimensions({ w: 400, h: 1600 }, 20000, "w", null)).toEqual({ w: 20000, h: 1600 });
    expect(resizeDimensions({ w: 400, h: 1600 }, 800, "h", null)).toEqual({ w: 400, h: 800 });
  });

  it("keeps dimensions positive for extreme aspect ratios", () => {
    expect(resizeDimensions({ w: 1, h: 20000 }, 20000, "w", 1 / 20000)).toEqual({ w: 1, h: 20000 });
    expect(resizeDimensions({ w: 20000, h: 1 }, 20000, "h", 20000)).toEqual({ w: 20000, h: 1 });
  });
});

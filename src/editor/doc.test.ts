import { describe, expect, it } from "vitest";
import { commit, handleOfMark, markAt, moveMarks, movePoint, newHistory, nextStep, redo, reshapeMark, sizeAfter, undo, withOp, type Mark, type Op } from "./doc";

const bmp = (w: number, h: number) => ({ width: w, height: h }) as ImageBitmap;

describe("editor document", () => {
  it("tracks the size through crops, cuts and resizes", () => {
    expect(sizeAfter(1000, 800, { kind: "crop", rect: { x: 10, y: 20, w: 300, h: 200 } })).toEqual({ w: 300, h: 200 });
    expect(sizeAfter(1000, 800, { kind: "cut", axis: "horizontal", from: 100, to: 250 })).toEqual({ w: 1000, h: 650 });
    expect(sizeAfter(1000, 800, { kind: "cut", axis: "vertical", from: 0, to: 10 })).toEqual({ w: 990, h: 800 });
    expect(sizeAfter(1000, 800, { kind: "replace", image: bmp(500, 400), map: { sx: 0.5, sy: 0.5, ox: 0, oy: 0 } })).toEqual({ w: 500, h: 400 });
    expect(sizeAfter(1000, 800, { kind: "hide", rect: { x: 0, y: 0, w: 5, h: 5 }, style: "blur", strength: 8 })).toEqual({ w: 1000, h: 800 });
  });

  it("moves points with the image", () => {
    const cut: Op = { kind: "cut", axis: "horizontal", from: 100, to: 150 };
    expect(movePoint({ x: 5, y: 80 }, cut)).toEqual({ x: 5, y: 80 });
    expect(movePoint({ x: 5, y: 200 }, cut)).toEqual({ x: 5, y: 150 });
    expect(movePoint({ x: 5, y: 120 }, cut)).toEqual({ x: 5, y: 100 }); // inside the band: collapses
    expect(movePoint({ x: 50, y: 50 }, { kind: "crop", rect: { x: 10, y: 20, w: 100, h: 100 } })).toEqual({ x: 40, y: 30 });
    expect(movePoint({ x: 100, y: 100 }, { kind: "replace", image: bmp(1, 1), map: { sx: 0.5, sy: 0.5, ox: 10, oy: 0 } })).toEqual({ x: 60, y: 50 });
  });

  it("moves and scales marks for size changes only", () => {
    const marks: Mark[] = [
      { id: "a", kind: "arrow", a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, color: "#f00", width: 6 },
      { id: "s", kind: "step", at: { x: 50, y: 50 }, n: 1, color: "#f00", size: 30 },
    ];
    const scaled = moveMarks(marks, { kind: "replace", image: bmp(1, 1), map: { sx: 2, sy: 2, ox: 0, oy: 0 } });
    expect(scaled[0]).toMatchObject({ b: { x: 200, y: 200 }, width: 12 });
    expect(scaled[1]).toMatchObject({ at: { x: 100, y: 100 }, size: 60 });
    expect(moveMarks(marks, { kind: "erase", rect: { x: 0, y: 0, w: 1, h: 1 } })).toBe(marks);
    const doc = withOp({ width: 200, height: 200, ops: [], marks }, { kind: "crop", rect: { x: 50, y: 50, w: 100, h: 100 } });
    expect(doc).toMatchObject({ width: 100, height: 100 });
    expect(doc.marks[1]).toMatchObject({ at: { x: 0, y: 0 } });
  });

  it("undoes and redoes", () => {
    let h = newHistory(10, 10);
    h = commit(h, { ...h.present, width: 5 });
    h = commit(h, { ...h.present, width: 3 });
    h = undo(h);
    expect(h.present.width).toBe(5);
    h = redo(h);
    expect(h.present.width).toBe(3);
    h = undo(undo(undo(h)));
    expect(h.present.width).toBe(10);
    expect(h.future).toHaveLength(2);
  });

  it("numbers steps and finds marks under the pointer", () => {
    const marks: Mark[] = [
      { id: "b", kind: "box", rect: { x: 10, y: 10, w: 100, h: 50 }, color: "#000", width: 4 },
      { id: "s", kind: "step", at: { x: 200, y: 200 }, n: 3, color: "#000", size: 32 },
    ];
    expect(nextStep(marks)).toBe(4);
    expect(markAt(marks, { x: 11, y: 30 }, 4)?.id).toBe("b"); // on the box edge
    expect(markAt(marks, { x: 60, y: 35 }, 4)).toBeNull(); // inside an outline box
    expect(markAt(marks, { x: 210, y: 205 }, 2)?.id).toBe("s");
  });
});

describe("editing marks", () => {
  const box: Mark = { id: "b", kind: "box", rect: { x: 10, y: 10, w: 100, h: 50 }, color: "#000", width: 4 };
  const arrow: Mark = { id: "a", kind: "arrow", a: { x: 0, y: 0 }, b: { x: 50, y: 50 }, color: "#000", width: 4 };

  it("finds the handle under the pointer", () => {
    expect(handleOfMark(box, { x: 111, y: 61 }, 5)).toBe("se");
    expect(handleOfMark(box, { x: 60, y: 9 }, 5)).toBe("n");
    expect(handleOfMark(box, { x: 60, y: 35 }, 5)).toBeNull();
    expect(handleOfMark(arrow, { x: 49, y: 51 }, 5)).toBe("b");
  });

  it("resizes boxes from any handle, flipping past the opposite side", () => {
    expect(reshapeMark(box, "se", { x: 210, y: 90 })).toMatchObject({ rect: { x: 10, y: 10, w: 200, h: 80 } });
    expect(reshapeMark(box, "w", { x: 150, y: 0 })).toMatchObject({ rect: { x: 110, y: 10, w: 40, h: 50 } });
    expect(reshapeMark(arrow, "a", { x: 5, y: 7 })).toMatchObject({ a: { x: 5, y: 7 }, b: { x: 50, y: 50 } });
  });
});

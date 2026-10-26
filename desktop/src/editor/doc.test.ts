import { describe, expect, it } from "vitest";
import { commit, handleOfMark, markAt, moveMarks, movePoint, newHistory, nextStep, redo, reshapeMark, shiftMark, sizeAfter, undo, withOp, type Mark, type Op } from "./doc";

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

  it("keeps a whole inspector gesture in one undo step without losing earlier drawings", () => {
    let h = newHistory(200, 200);
    const mark: Mark = { id: "ink", kind: "stroke", tool: "pen", points: [{ x: 20, y: 30 }], color: "#123456", width: 4, opacity: 1 };
    h = commit(h, { ...h.present, marks: [mark] });
    const before = h.present;
    for (let width = 5; width <= 120; width++) {
      h = commit(h, { ...h.present, marks: [{ ...mark, width }] }, before);
    }
    expect(h.past).toHaveLength(2);
    expect(h.present.marks[0]).toMatchObject({ width: 120 });
    expect(undo(h).present).toBe(before);
    expect(undo(undo(h)).present.marks).toEqual([]);
    expect(redo(undo(h)).present.marks[0]).toMatchObject({ width: 120 });
  });

  it("separates gestures and ignores commits that leave the document unchanged", () => {
    let h = newHistory(100, 100);
    expect(commit(h, h.present)).toBe(h);
    const first = h.present;
    h = commit(h, { ...h.present, width: 50 }, first);
    const second = h.present;
    h = commit(h, { ...h.present, width: 25 }, second);
    expect(h.past).toHaveLength(2);
    h = undo(h);
    h = commit(h, { ...h.present, width: 75 }, h.present);
    expect(h.future).toEqual([]);
    expect(undo(h).present).toBe(second);
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

describe("paint marks", () => {
  const stroke: Mark = { id: "ink", kind: "stroke", tool: "pen", points: [{ x: 20, y: 30 }, { x: 60, y: 80 }], color: "#123456", width: 8, opacity: 0.7 };
  const ellipse: Mark = { id: "oval", kind: "ellipse", rect: { x: 20, y: 30, w: 80, h: 40 }, color: "#123456", width: 4, opacity: 1 };
  const line: Mark = { id: "line", kind: "line", a: { x: 10, y: 20 }, b: { x: 90, y: 70 }, color: "#123456", width: 4, opacity: 1 };

  it("selects ink and single-click dots without selecting their empty bounding area", () => {
    expect(markAt([stroke], { x: 40, y: 55 }, 1)?.id).toBe("ink");
    expect(markAt([stroke], { x: 20, y: 80 }, 1)).toBeNull();
    const dot: Mark = { ...stroke, points: [{ x: 10, y: 10 }] };
    expect(markAt([dot], { x: 13, y: 10 }, 0)?.id).toBe("ink");
    expect(markAt([dot], { x: 15, y: 10 }, 0)).toBeNull();
    expect(markAt([{ ...stroke, points: [] }], { x: 0, y: 0 }, 5)).toBeNull();
  });

  it("selects the visible smoothed curve rather than its raw sample corner", () => {
    const curve: Mark = { ...stroke, width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    expect(markAt([curve], { x: 75, y: 12.5 }, 1)?.id).toBe("ink");
    expect(markAt([curve], { x: 100, y: 0 }, 1)).toBeNull();
    expect(markAt([{ ...curve, tool: "pencil" }], { x: 100, y: 0 }, 1)?.id).toBe("ink");
  });

  it("hits ellipse outlines, fills, and wide strokes accurately", () => {
    expect(markAt([ellipse], { x: 100, y: 50 }, 0)?.id).toBe("oval");
    expect(markAt([ellipse], { x: 60, y: 50 }, 0)).toBeNull();
    expect(markAt([ellipse], { x: 20, y: 30 }, 0)).toBeNull();
    expect(markAt([{ ...ellipse, fill: true }], { x: 60, y: 50 }, 0)?.id).toBe("oval");
    expect(markAt([{ id: "box", kind: "box", rect: { x: 10, y: 10, w: 40, h: 40 }, color: "#000", width: 20 }], { x: 4, y: 30 }, 0)?.id).toBe("box");
  });

  it("moves and scales new tools without mutating existing strokes", () => {
    expect(shiftMark(stroke, 3, -4)).toMatchObject({ points: [{ x: 23, y: 26 }, { x: 63, y: 76 }] });
    expect(stroke.points[0]).toEqual({ x: 20, y: 30 });
    const scaled = moveMarks([stroke, ellipse, line], { kind: "replace", image: bmp(200, 200), map: { sx: 2, sy: 2, ox: 5, oy: 7 } });
    expect(scaled[0]).toMatchObject({ points: [{ x: 45, y: 67 }, { x: 125, y: 167 }], width: 16, opacity: 0.7 });
    expect(scaled[1]).toMatchObject({ rect: { x: 45, y: 67, w: 160, h: 80 }, width: 8 });
    expect(scaled[2]).toMatchObject({ a: { x: 25, y: 47 }, b: { x: 185, y: 147 }, width: 8 });
    expect(reshapeMark(ellipse, "se", { x: 140, y: 90 })).toMatchObject({ rect: { x: 20, y: 30, w: 120, h: 60 } });
    expect(reshapeMark(line, "b", { x: 110, y: 90 })).toMatchObject({ b: { x: 110, y: 90 } });
    expect(handleOfMark(line, { x: 90, y: 70 }, 3)).toBe("b");
  });

  it("rasterizes and cuts in one undoable edit without leaving duplicate vector ink", () => {
    const initial = { ...newHistory(200, 200), present: { width: 200, height: 200, ops: [], marks: [stroke, ellipse] } };
    const raster = withOp(initial.present, { kind: "rasterize", marks: initial.present.marks });
    expect(raster.marks).toEqual([]);
    expect(raster.ops[0]).toMatchObject({ kind: "rasterize", marks: [stroke, ellipse] });
    const history = commit(initial, withOp(raster, { kind: "cut", axis: "horizontal", from: 40, to: 60 }));
    expect(history.present.height).toBe(180);
    expect(history.present.marks).toEqual([]);
    expect(undo(history).present).toBe(initial.present);
    expect(redo(undo(history)).present).toBe(history.present);
  });
});

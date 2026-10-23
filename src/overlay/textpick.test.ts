import { describe, expect, it } from "vitest";
import type { TextLine } from "../shared/api";
import { flatten, pickedBands, pickedText, wordNear } from "./textpick";

const word = (text: string, x: number, y: number, w = 40, h = 16) => ({ text, rect: { x, y, w, h } });

// Two lines on the left, one line in a second column on the right.
const lines: TextLine[] = [
  { words: [word("Salom", 10, 10), word("dunyo", 60, 10)] },
  { words: [word("Ikkinchi", 10, 40, 70), word("qator", 90, 40)] },
  { words: [word("Right", 400, 12), word("column", 450, 12)] },
];
const words = flatten(lines);

describe("picking text on screen", () => {
  it("keeps reading order and lines", () => {
    expect(words.map((w) => `${w.line}:${w.text}`)).toEqual(["0:Salom", "0:dunyo", "1:Ikkinchi", "1:qator", "2:Right", "2:column"]);
  });

  it("finds the word under or nearest to the pointer", () => {
    expect(wordNear(words, { x: 70, y: 15 })).toBe(1); // on "dunyo"
    expect(wordNear(words, { x: 300, y: 45 })).toBe(3); // past the end of line 2
    expect(wordNear(words, { x: 0, y: 34 })).toBe(2); // between lines, nearer the second
    expect(wordNear(words, { x: 460, y: 20 })).toBe(5); // the right-hand column
    expect(wordNear([], { x: 0, y: 0 })).toBe(-1);
  });

  it("copies spaces within a line and new lines between lines, in either direction", () => {
    expect(pickedText(words, 1, 3)).toBe("dunyo\nIkkinchi qator");
    expect(pickedText(words, 3, 1)).toBe("dunyo\nIkkinchi qator");
    expect(pickedText(words, 0, 0)).toBe("Salom");
  });

  it("highlights one band per line, covering the gaps", () => {
    expect(pickedBands(words, 0, 2)).toEqual([
      { x: 10, y: 10, w: 90, h: 16 },
      { x: 10, y: 40, w: 70, h: 16 },
    ]);
  });
});

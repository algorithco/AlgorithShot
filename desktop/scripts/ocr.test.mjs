import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, OEM, PSM } from "tesseract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("bundled models read English, Russian and Uzbek with physical word boxes offline", { timeout: 120_000 }, async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("The offline OCR test must not use the network"); };
  let worker;
  try {
    worker = await createWorker(["eng", "rus", "uzb", "uzb_cyrl"], OEM.LSTM_ONLY, {
      langPath: join(root, "ocr-data"), gzip: false, cacheMethod: "none",
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(join(root, "test/fixtures/ocr-languages.png"), {}, { blocks: true, text: true });
    assert.match(data.text, /Hello/i);
    assert.match(data.text, /Привет/iu);
    assert.match(data.text, /Salom/i);
    const words = data.blocks.flatMap((block) => block.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    assert.ok(words.length >= 6);
    assert.ok(words.every((word) => word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0));
  } finally {
    await worker?.terminate();
    globalThis.fetch = previousFetch;
  }
});

import { emit, listen } from "@tauri-apps/api/event";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";

type Request = { id: string; png: number[] };
let worker: Promise<Worker> | undefined;
let queue = Promise.resolve();

function engine(): Promise<Worker> {
  if (!worker) {
    const base = new URL("/ocr/", location.href);
    worker = createWorker(["eng", "rus", "uzb", "uzb_cyrl"], OEM.LSTM_ONLY, {
      workerPath: new URL("worker.min.js", base).href,
      corePath: new URL("tesseract-core-lstm.wasm.js", base).href,
      langPath: base.href,
      workerBlobURL: false,
      gzip: false,
      cacheMethod: "none",
    }).then(async (engine) => {
      await engine.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      return engine;
    }).catch((error: unknown) => { worker = undefined; throw error; });
  }
  return worker;
}

await listen<Request>("ocr:read", ({ payload }) => {
  queue = queue.then(async () => {
    try {
      const engineWorker = await engine();
      const { data } = await engineWorker.recognize(new Blob([new Uint8Array(payload.png)], { type: "image/png" }), {}, { blocks: true, text: true });
      const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
        words: line.words.filter((word) => word.text.trim()).map((word) => ({
          text: word.text,
          rect: { x: word.bbox.x0, y: word.bbox.y0, w: word.bbox.x1 - word.bbox.x0, h: word.bbox.y1 - word.bbox.y0 },
        })),
      }))));
      await emit("ocr:result", { id: payload.id, result: { lang: "eng+rus+uzb+uzb_cyrl", lines } });
    } catch (error: unknown) {
      await emit("ocr:result", { id: payload.id, error: error instanceof Error ? error.message : String(error) });
    }
  }).catch((error: unknown) => { console.error("Offline OCR service:", error); });
});
await emit("ocr:ready");

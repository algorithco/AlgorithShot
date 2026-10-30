/** A raster surface also supported by older system WebKit versions. */
export type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function context2d(canvas: RasterCanvas): RasterContext {
  const context = canvas.getContext("2d") as RasterContext | null;
  if (!context) throw new Error("Could not prepare the image canvas");
  return context;
}

export function createCanvas(width: number, height: number): RasterCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error("Invalid image dimensions");
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(w, h);
      if (canvas.getContext("2d")) return canvas;
    } catch {
      // Some system WebKit releases expose OffscreenCanvas without 2D support.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

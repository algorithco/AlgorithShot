import { cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const tesseract = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(createRequire(join(tesseract, "package.json")).resolve("tesseract.js-core/package.json"));
const output = join(root, "public/ocr");
mkdirSync(output, { recursive: true });
for (const name of ["tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm.js"]) cpSync(join(core, name), join(output, name));
cpSync(join(tesseract, "dist/worker.min.js"), join(output, "worker.min.js"));
for (const name of ["LICENSE", ...readdirSync(join(root, "ocr-data")).filter((n) => n.endsWith(".traineddata"))]) {
  cpSync(join(root, "ocr-data", name), join(output, name));
}
const checksums = JSON.parse(readFileSync(join(root, "ocr-data/checksums.json"), "utf8"));
for (const [name, expected] of Object.entries(checksums)) {
  const hash = createHash("sha256").update(readFileSync(join(output, name))).digest("hex");
  if (hash !== expected) throw new Error(`OCR model checksum mismatch: ${name}`);
}

# Offline OCR data

These unmodified English, Russian, Uzbek Latin and Uzbek Cyrillic models come
from `tesseract-ocr/tessdata_fast` at commit
`87416418657359cb625c412a48b6e1d6d41c29bd`:

https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd

The upstream Apache-2.0 license is included in `LICENSE`. `checksums.json`
records SHA-256 digests. `scripts/prepare-ocr.mjs` verifies the models and copies
them with the installed, lockfile-pinned WASM engine to `public/ocr/` before
development or production builds. No language or engine download happens
when the installed app reads text.

When updating a model, select an upstream commit, review its license and record
the new digest. Run `pnpm test:ocr` and check word selection and privacy review
in the native app. `test/fixtures/ocr-languages.png` contains synthetic text.

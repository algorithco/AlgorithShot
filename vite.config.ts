/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import { fakeShots } from "./dev/fake-shots";

const host = process.env.TAURI_DEV_HOST;

// One page per window type: library, capture overlay, quick card, editor, pin.
export default defineConfig(() => ({
  // fakeShots only runs in `vite dev`: fake images for trying pages in a browser.
  plugins: [react(), fakeShots()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        overlay: "overlay.html",
        card: "card.html",
        editor: "editor.html",
        pin: "pin.html",
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
}));

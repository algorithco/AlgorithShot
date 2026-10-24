import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./library.css";
import { App } from "./App";

// In a plain browser during development, fake the Rust side (see src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMocks } = await import("../dev/mock");
  installMocks("main");
}

createRoot(document.getElementById("root")!).render(<App />);

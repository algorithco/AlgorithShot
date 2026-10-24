import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./pin.css";
import { Pin } from "./Pin";

// In a plain browser during development, fake the Rust side (see src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMocks } = await import("../dev/mock");
  installMocks("pin-mock");
}

createRoot(document.getElementById("root")!).render(<Pin />);

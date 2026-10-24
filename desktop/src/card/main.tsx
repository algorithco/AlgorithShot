import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./card.css";
import { Card } from "./Card";

// In a plain browser during development, fake the Rust side (see src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMocks } = await import("../dev/mock");
  installMocks("card");
}

createRoot(document.getElementById("root")!).render(<Card />);

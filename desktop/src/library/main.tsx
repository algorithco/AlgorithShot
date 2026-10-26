import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./library.css";
import { App } from "./App";
import { StartupBoundary } from "./StartupBoundary";
import { UpdateFrame } from "./UpdateBanner";
import { startUpdateChecks } from "./updates";

const desktop = "__TAURI_INTERNALS__" in window;
if (desktop && !import.meta.env.DEV && import.meta.env.VITE_DISABLE_UPDATES !== "1") {
  const stop = startUpdateChecks();
  import.meta.hot?.dispose(stop);
}

// In a plain browser during development, fake the Rust side (see src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installMocks } = await import("../dev/mock");
  installMocks("main");
}

if (import.meta.env.DEV && !desktop && new URLSearchParams(location.search).has("update-preview")) {
  const { installUpdatePreview } = await import("../dev/UpdatePreview");
  await installUpdatePreview(new URLSearchParams(location.search).get("update-preview")!);
}

const root = createRoot(document.getElementById("root")!);
if (import.meta.env.DEV && new URLSearchParams(location.search).has("loading-preview")) {
  const { initSettings, useSettings } = await import("../shared/settings");
  await initSettings();
  const language = new URLSearchParams(location.search).get("language");
  if (language === "en" || language === "uz" || language === "ru") {
    useSettings.setState((state) => ({ settings: { ...state.settings!, language } }));
  }
  const { LoadingPreview } = await import("../dev/LoadingPreview");
  root.render(<LoadingPreview />);
} else {
  root.render(<StartupBoundary><UpdateFrame><App /></UpdateFrame></StartupBoundary>);
}

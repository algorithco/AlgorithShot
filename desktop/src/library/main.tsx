import { getCurrentWindow } from "@tauri-apps/api/window";
import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./library.css";
import { App, SetupWindow } from "./App";
import { StartupBoundary } from "./StartupBoundary";
import { UpdateFrame } from "./UpdateBanner";
import { startUpdateChecks } from "./updates";

const desktop = "__TAURI_INTERNALS__" in window;
// The setup popup shows only the guided setup: no loading screen, updates or library.
const setupWindow = desktop ? getCurrentWindow().label === "setup" : import.meta.env.DEV && new URLSearchParams(location.search).has("setup-window");
if (desktop && !import.meta.env.DEV && !setupWindow) {
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
} else if (setupWindow) {
  const { initSettings } = await import("../shared/settings");
  await initSettings();
  root.render(<SetupWindow />);
} else {
  root.render(<StartupBoundary><UpdateFrame><App /></UpdateFrame></StartupBoundary>);
}

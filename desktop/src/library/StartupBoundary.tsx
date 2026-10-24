import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorText } from "../shared/api";
import { useT } from "../shared/i18n";
import { initSettings, useSettings } from "../shared/settings";
import { needsSetup } from "./setup";
import { LoadingScreen } from "./LoadingScreen";
import { prepareStartup, STARTUP_INTRO_MS, StartupTimeoutError, type StartupStage } from "./startup";
import { useLibrary } from "./store";

/** Only the main window has a startup presentation. Capture stays instant. */
export function StartupBoundary({ children }: { children: ReactNode }) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<StartupStage>("settings");
  const [failure, setFailure] = useState<{ message: string; timedOut: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let exitTimer = 0;
    setStage("settings");
    setFailure(null);
    // Catch tray/command-line navigation throughout the loading presentation.
    const nav = listen<string>("nav", (event) => { if (!controller.signal.aborted) location.hash = event.payload; });

    prepareStartup({
      loadSettings: () => Promise.all([initSettings(), nav]),
      loadLibrary: () => useLibrary.getState().refresh(),
      shouldLoadLibrary: () => !needsSetup(useSettings.getState().settings) && !["#welcome", "#setup", "#settings", "#cleanup"].includes(location.hash),
      onStage: setStage,
      signal: controller.signal,
      minimumMs: reducedMotion ? 0 : STARTUP_INTRO_MS,
    }).then(() => {
      if (controller.signal.aborted) return;
      setStage("ready");
      exitTimer = window.setTimeout(() => setDismissed(true), reducedMotion ? 0 : 280);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setFailure({ message: errorText(error), timedOut: error instanceof StartupTimeoutError });
      }
    });

    return () => {
      controller.abort();
      window.clearTimeout(exitTimer);
      void nav.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [attempt]);

  return (
    <>
      {stage === "ready" && !failure && children}
      {!dismissed && (
        <LoadingScreen
          stage={stage}
          error={failure ? (failure.timedOut ? t("startup.timeout") : failure.message) : null}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
    </>
  );
}

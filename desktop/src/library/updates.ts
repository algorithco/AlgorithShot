import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { createStore } from "zustand/vanilla";
import { errorText } from "../shared/api";

type PendingUpdate = Pick<Update, "version" | "downloadAndInstall" | "close">;
type UpdateDependencies = {
  check: () => Promise<PendingUpdate | null>;
  restart: () => Promise<void>;
};

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "installing" | "restarting" | "error";
  version: string | null;
  downloaded: number;
  total: number | null;
  installed: boolean;
  error: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
};

/** Keep the native update resource across page changes and failed downloads. */
export function createUpdateStore(dependencies: UpdateDependencies) {
  let pending: PendingUpdate | null = null;

  return createStore<UpdateState>((set, get) => ({
    status: "idle",
    version: null,
    downloaded: 0,
    total: null,
    installed: false,
    error: null,

    check: async () => {
      if (get().status === "checking" || pending || get().installed) return;
      set({ status: "checking" });
      try {
        pending = await dependencies.check();
        set({ status: pending ? "available" : "idle", version: pending?.version ?? null });
      } catch (error) {
        // Being offline (or having no published release yet) must not block startup.
        console.warn("Update check failed:", errorText(error));
        set({ status: "idle" });
      }
    },

    install: async () => {
      const { status, installed } = get();
      if (status !== "available" && status !== "error") return;
      if (!pending && !installed) return;

      set({ status: installed ? "restarting" : "downloading", downloaded: 0, total: null, error: null });
      try {
        if (!installed && pending) {
          const update = pending;
          const onProgress = (event: DownloadEvent) => {
            if (event.event === "Started") {
              set({ downloaded: 0, total: event.data.contentLength || null });
            } else if (event.event === "Progress") {
              set((state) => ({ downloaded: state.downloaded + event.data.chunkLength }));
            } else {
              // The plugin verifies the signature before launching the installer.
              set({ status: "installing" });
            }
          };
          // On Windows, the installer exits the app and starts the new version.
          await update.downloadAndInstall(onProgress, { timeout: 180_000 });
          pending = null;
          set({ installed: true, status: "restarting" });
          await update.close().catch(() => {});
        }
        // Other desktop platforms return after installation and need a restart.
        await dependencies.restart();
      } catch (error) {
        set({ status: "error", error: errorText(error) });
      }
    },
  }));
}

export const updateStore = createUpdateStore({
  check: () => check({ timeout: 8000 }),
  restart: relaunch,
});

const RECHECK_MS = 15 * 60_000;
const FOCUS_THROTTLE_MS = 60_000;

/** Called before rendering, so the first network request overlaps the splash. */
export function startUpdateChecks(store = updateStore) {
  let lastCheck = -Infinity;
  const run = (force = false) => {
    if (!force && Date.now() - lastCheck < FOCUS_THROTTLE_MS) return;
    lastCheck = Date.now();
    void store.getState().check();
  };
  const onFocus = () => run();
  const onOnline = () => run(true);
  const onVisibility = () => { if (!document.hidden) run(); };

  run();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  const timer = window.setInterval(() => run(), RECHECK_MS);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

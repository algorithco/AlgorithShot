// Browser-only preview. This module is never imported in production or Tauri.
import { createUpdateStore, updateStore } from "../library/updates";

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export async function installUpdatePreview(mode: string) {
  let attempt = 0;
  const preview = createUpdateStore({
    check: async () => ({
      version: "0.2.0",
      close: async () => {},
      downloadAndInstall: async (receive) => {
        if (mode === "error" && attempt++ === 0) throw new Error("Preview: connection interrupted");
        receive?.({ event: "Started", data: { contentLength: 8 * 1024 * 1024 } });
        for (let chunk = 0; chunk < 8; chunk++) {
          await pause(350);
          receive?.({ event: "Progress", data: { chunkLength: 1024 * 1024 } });
        }
        receive?.({ event: "Finished" });
        await pause(900);
      },
    }),
    restart: async () => {},
  });
  const unsubscribe = preview.subscribe((state) => updateStore.setState(state));
  updateStore.setState(preview.getState());
  await preview.getState().check();
  if (mode === "error") await preview.getState().install();
  if (mode === "downloading") preview.setState({ status: "downloading", total: 8 * 1024 * 1024, downloaded: 3 * 1024 * 1024 });
  if (mode === "installing") preview.setState({ status: "installing" });
  if (mode === "restarting") preview.setState({ status: "restarting", installed: true });
  import.meta.hot?.dispose(unsubscribe);
}

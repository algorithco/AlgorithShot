// Development-only visual fixture. No screen pixels or native commands are used.
import { createRoot } from "react-dom/client";
import { RecordingPanel } from "../src/recording/RecordingPanel";
import { recordingApi, idleRecording, type RecordingStatus } from "../src/recording/api";
import { useSettings } from "../src/shared/settings";
import type { Settings } from "../src/shared/api";
import "../src/shared/base.css";

if (!import.meta.env.DEV) throw new Error("Recording preview is development-only");
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
const params = new URLSearchParams(location.search);
const language = params.get("language");
if (language === "en" || language === "uz" || language === "ru") {
  useSettings.setState({ settings: { language } as Settings });
}
let status: RecordingStatus = { ...idleRecording };
let started = 0;
const completed: RecordingStatus = {
  ...idleRecording, phase: "completed", width: 1920, height: 1080, fps: 30,
  frames: 3690, elapsedMs: 123000, bytes: 33792000,
  path: "C:\\Synthetic preview\\Recordings\\Example video.mp4",
};
if (params.get("state") === "completed") status = completed;
if (params.get("state") === "failed") status = { ...idleRecording, phase: "failed", error: "Synthetic error: no compatible hardware encoder was found." };
recordingApi.sources = async () => ({ supported: true, reason: null, sources: [
  { id: "monitor:synthetic", name: "Synthetic display", kind: "monitor", width: 1920, height: 1080 },
  { id: "window:synthetic", name: "Synthetic tutorial window", kind: "window", width: 1280, height: 720 },
] });
recordingApi.status = async () => {
  if (status.phase === "recording") status = { ...status, elapsedMs: Date.now() - started, frames: Math.floor((Date.now() - started) * .03), bytes: Math.floor((Date.now() - started) * 2600) };
  return { ...status };
};
recordingApi.start = async (options) => {
  started = Date.now();
  return status = { ...idleRecording, phase: "recording", width: 1920, height: 1080, fps: options.fps };
};
recordingApi.stop = async () => status = { ...status, phase: "completed", path: completed.path };
recordingApi.open = recordingApi.reveal = async () => {};

createRoot(document.getElementById("root")!).render(
  <main style={{ minHeight: "100vh", padding: 48 }}>
    <h1 className="display">Recording interface preview</h1>
    <p>Simulated controls for visual testing. Nothing on your screen is recorded.</p>
    <RecordingPanel />
  </main>,
);

import { invoke } from "@tauri-apps/api/core";

export type RecordingPhase = "idle" | "starting" | "recording" | "stopping" | "completed" | "failed";

export type RecordingStatus = {
  phase: RecordingPhase;
  elapsedMs: number;
  frames: number;
  bytes: number;
  path: string | null;
  error: string | null;
  width?: number;
  height?: number;
  fps?: number;
  droppedFrames?: number;
  encoder?: string | null;
};

export type RecordingSource = {
  id: string;
  name: string;
  kind: "monitor" | "window";
  width: number;
  height: number;
};

export type RecordingSources = {
  supported: boolean;
  reason: string | null;
  sources: RecordingSource[];
};

export type RecordingOptions = { sourceId: string; fps: 30 | 60; cursor: boolean };

export const idleRecording: RecordingStatus = {
  phase: "idle", elapsedMs: 0, frames: 0, bytes: 0, path: null, error: null,
};

export function isRecordingActive(phase: RecordingPhase): boolean {
  return phase === "starting" || phase === "recording" || phase === "stopping";
}

/** Durations are elapsed time, so they must not wrap after an hour. */
export function recordingDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes < 60 ? `${String(minutes).padStart(2, "0")}:${rest}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}

export function nativeRecordingAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const recordingApi = {
  sources: () => invoke<RecordingSources>("recording_sources"),
  status: () => invoke<RecordingStatus>("recording_status"),
  start: (options: RecordingOptions) => invoke<RecordingStatus>("recording_start", { options }),
  stop: () => invoke<RecordingStatus>("recording_stop"),
  open: () => invoke<void>("recording_open"),
  reveal: () => invoke<void>("recording_reveal"),
};

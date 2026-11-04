import { describe, expect, it } from "vitest";
import { isRecordingActive, recordingDuration, type RecordingPhase } from "./api";

describe("recording duration", () => {
  it("keeps the elapsed recording time across minute and hour boundaries", () => {
    const samples: [number, string][] = [
      [0, "00:00"],
      [999, "00:00"],
      [1000, "00:01"],
      [59_999, "00:59"],
      [60_000, "01:00"],
      [3_599_999, "59:59"],
      [3_600_000, "1:00:00"],
      [3_661_000, "1:01:01"],
      [90_061_000, "25:01:01"],
    ];
    for (const [milliseconds, expected] of samples) expect(recordingDuration(milliseconds)).toBe(expected);
  });

  it("never shows invalid or negative durations from an unavailable clock", () => {
    for (const milliseconds of [-1, -60_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(recordingDuration(milliseconds)).toBe("00:00");
    }
  });
});

describe("recording controls", () => {
  it("keeps Stop available throughout startup, capture, and finalization", () => {
    const lifecycle: RecordingPhase[] = ["idle", "starting", "recording", "stopping", "completed"];
    expect(lifecycle.map(isRecordingActive)).toEqual([false, true, true, true, false]);
  });

  it("releases the active controls after a failure so recording can be configured again", () => {
    const failedLifecycle: RecordingPhase[] = ["idle", "starting", "failed"];
    expect(failedLifecycle.map(isRecordingActive)).toEqual([false, true, false]);
  });
});

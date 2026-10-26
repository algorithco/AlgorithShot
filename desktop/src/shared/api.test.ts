import { afterEach, describe, expect, it, vi } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";
import { shotUrl } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn(), invoke: vi.fn() }));

afterEach(() => {
  delete (globalThis as { __SHOT_BASE__?: string }).__SHOT_BASE__;
  vi.clearAllMocks();
});

describe("native image and frame URLs", () => {
  it.each(["http://shot.localhost/", "shot://localhost/"])("uses Tauri's platform origin %s", (origin) => {
    vi.mocked(convertFileSrc).mockReturnValue(origin);
    expect(shotUrl("thumb/shot-id?v=2")).toBe(`${origin}thumb/shot-id?v=2`);
    expect(convertFileSrc).toHaveBeenCalledWith("", "shot");
  });

  it("keeps browser fixtures independent of the native runtime", () => {
    (globalThis as { __SHOT_BASE__?: string }).__SHOT_BASE__ = "/dev-shot/";
    expect(shotUrl("image/mock-1")).toBe("/dev-shot/image/mock-1");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
});

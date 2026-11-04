import { describe, expect, it, vi } from "vitest";
import { LatestTask } from "./latestTask";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("slow image estimates", () => {
  it("runs only one task at a time and skips superseded queued images", async () => {
    const queue = new LatestTask();
    const slow = deferred();
    const first = vi.fn(() => slow.promise);
    const skipped = vi.fn(async () => "old settings");
    const newest = vi.fn(async () => "latest settings");
    const running = queue.run(first);
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();

    const old = queue.run(skipped);
    const latest = queue.run(newest);
    expect(skipped).not.toHaveBeenCalled();
    expect(newest).not.toHaveBeenCalled();
    slow.resolve();
    await running;
    expect(await old).toBeUndefined();
    expect(await latest).toBe("latest settings");
    expect(skipped).not.toHaveBeenCalled();
    expect(newest).toHaveBeenCalledOnce();
  });

  it("discards pending work when the editor closes or starts saving", async () => {
    const queue = new LatestTask();
    const slow = deferred();
    const running = queue.run(() => slow.promise);
    await Promise.resolve();
    const pixels = vi.fn(async () => "large pixel buffer");
    const pending = queue.run(pixels);
    queue.cancel();
    slow.resolve();
    await running;
    expect(await pending).toBeUndefined();
    expect(pixels).not.toHaveBeenCalled();
  });

  it("can estimate again after an encoding error", async () => {
    const queue = new LatestTask();
    await expect(queue.run(async () => { throw new Error("too_big"); })).rejects.toThrow("too_big");
    expect(await queue.run(async () => 12345)).toBe(12345);
  });
});

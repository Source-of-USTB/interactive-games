import { describe, expect, it, vi } from "vitest";
import { BroadcastScheduler } from "./broadcast-scheduler.js";

describe("BroadcastScheduler", () => {
  it("coalesces delayed reasons to the latest state", () => {
    vi.useFakeTimers();
    const published: Array<{ state: number; reason: string }> = [];
    const scheduler = new BroadcastScheduler<number>({
      delayMs: 25,
      coalescedReasons: new Set(["vote-cast"]),
      publishNow: (state, reason) => published.push({ state, reason }),
    });

    scheduler.publish(1, "vote-cast");
    scheduler.publish(2, "vote-cast");
    expect(published).toEqual([]);

    vi.advanceTimersByTime(24);
    expect(published).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(published).toEqual([{ state: 2, reason: "vote-cast" }]);
    vi.useRealTimers();
  });

  it("publishes urgent changes immediately and discards stale delayed state", () => {
    vi.useFakeTimers();
    const published: Array<{ state: number; reason: string }> = [];
    const scheduler = new BroadcastScheduler<number>({
      delayMs: 25,
      coalescedReasons: new Set(["vote-cast"]),
      publishNow: (state, reason) => published.push({ state, reason }),
    });

    scheduler.publish(1, "vote-cast");
    scheduler.publish(3, "authoring-slot-locked");
    vi.advanceTimersByTime(25);

    expect(published).toEqual([{ state: 3, reason: "authoring-slot-locked" }]);
    vi.useRealTimers();
  });
});

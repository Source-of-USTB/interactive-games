import { describe, expect, it } from "vitest";
import type { DailyStats } from "@codegame/game-core";
import { DailyStatsCache } from "./daily-stats-cache.js";

function stats(date: string, commandsSubmitted = 0): DailyStats {
  return {
    date,
    participantSessions: 0,
    commandsSubmitted,
    bugsFixed: 0,
    successfulDeliveries: 0,
    roundsPlayed: 0,
    cityEnergy: 0,
  };
}

describe("DailyStatsCache", () => {
  it("loads once per date and reuses the current snapshot", () => {
    let today = "2026-09-04";
    const loadedDates: string[] = [];
    const store = {
      getDaily: (date: string) => {
        loadedDates.push(date);
        return stats(date);
      },
      incrementDaily: (_date: string, _increments: Partial<Omit<DailyStats, "date">>) => stats(today, 1),
    };
    const cache = new DailyStatsCache(store, () => today);

    expect(cache.current()).toEqual(stats("2026-09-04"));
    expect(cache.current()).toEqual(stats("2026-09-04"));
    expect(loadedDates).toEqual(["2026-09-04"]);

    today = "2026-09-05";
    expect(cache.current()).toEqual(stats("2026-09-05"));
    expect(loadedDates).toEqual(["2026-09-04", "2026-09-05"]);
  });

  it("updates the cache from the persisted increment result", () => {
    let today = "2026-09-04";
    const incrementedDates: string[] = [];
    const store = {
      getDaily: (date: string) => stats(date),
      incrementDaily: (date: string, _increments: Partial<Omit<DailyStats, "date">>) => {
        incrementedDates.push(date);
        return stats(date, 5);
      },
    };
    const cache = new DailyStatsCache(store, () => today);

    expect(cache.increment({ commandsSubmitted: 5 })).toEqual(stats(today, 5));
    expect(cache.current()).toEqual(stats(today, 5));
    expect(incrementedDates).toEqual([today]);
  });
});

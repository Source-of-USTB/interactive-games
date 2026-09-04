import type { DailyStats } from "@codegame/game-core";

export type DailyStatsIncrements = Partial<Omit<DailyStats, "date">>;

export interface DailyStatsStore {
  getDaily(date: string): DailyStats;
  incrementDaily(date: string, increments: DailyStatsIncrements): DailyStats;
}

export class DailyStatsCache {
  private dailyDate: string;
  private dailySnapshot: DailyStats;

  constructor(
    private readonly store: DailyStatsStore,
    private readonly today: () => string,
  ) {
    this.dailyDate = today();
    this.dailySnapshot = store.getDaily(this.dailyDate);
  }

  current(): DailyStats {
    const date = this.today();
    if (date !== this.dailyDate) {
      this.dailyDate = date;
      this.dailySnapshot = this.store.getDaily(date);
    }
    return this.dailySnapshot;
  }

  increment(increments: DailyStatsIncrements): DailyStats {
    const date = this.today();
    this.dailyDate = date;
    this.dailySnapshot = this.store.incrementDaily(date, increments);
    return this.dailySnapshot;
  }
}

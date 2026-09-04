interface PendingBroadcast<State> {
  state: State;
  reason: string;
}

export interface BroadcastSchedulerOptions<State> {
  delayMs: number;
  coalescedReasons: ReadonlySet<string>;
  publishNow: (state: State, reason: string) => void;
}

export class BroadcastScheduler<State> {
  private pending: PendingBroadcast<State> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: BroadcastSchedulerOptions<State>) {}

  publish(state: State, reason: string): void {
    if (!this.options.coalescedReasons.has(reason)) {
      this.clearPending();
      this.options.publishNow(state, reason);
      return;
    }

    this.pending = { state, reason };
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.options.delayMs);
  }

  flush(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.options.publishNow(pending.state, pending.reason);
  }

  dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending = undefined;
  }
}

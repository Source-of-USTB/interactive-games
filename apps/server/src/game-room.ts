import { randomUUID } from "node:crypto";
import {
  GAME_MAPS,
  chooseNextRound,
  collectSlots,
  compileProgram,
  executeProgram,
  getMapById,
  publicMap,
  traceDuration,
  type ChoiceValue,
  type DailyStats,
  type ExecutionResult,
  type GameMap,
  type GameMode,
  type ProgramNode,
  type ProgramSlot,
  type PublicRoundState,
  type RoundPhase,
  type VoteTally,
} from "@codegame/game-core";
import type { PersistedRound } from "./database.js";

export interface RoomTimings {
  joinMs: number;
  voteMs: number;
  revealMs: number;
  compileMs: number;
}

export const DEFAULT_TIMINGS: RoomTimings = {
  joinMs: 10_000,
  voteMs: 10_000,
  revealMs: 3_000,
  compileMs: 3_000,
};

interface PlayerSession {
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomCheckpoint {
  version: 1;
  roomId: string;
  roundId: string;
  mode: GameMode;
  mapId: string;
  phase: RoundPhase;
  lockedChoices: Record<string, ChoiceValue>;
  currentSlotIndex: number;
  startedAt: number;
}

export interface RoomHooks {
  onChange: (state: PublicRoundState, reason: string) => void;
  onCheckpoint: (checkpoint: RoomCheckpoint) => void;
  onRoundComplete: (round: PersistedRound) => void;
  onDailyIncrement: (increments: Partial<Omit<DailyStats, "date">>) => void;
  onSystemEvent: (eventType: string, details: unknown) => void;
}

interface AdminStartOptions {
  mapId?: string;
  mode?: GameMode;
}

const noOpHooks: RoomHooks = {
  onChange: () => undefined,
  onCheckpoint: () => undefined,
  onRoundComplete: () => undefined,
  onDailyIncrement: () => undefined,
  onSystemEvent: () => undefined,
};

function choicesEqual(a: ChoiceValue, b: ChoiceValue): boolean {
  return a === b;
}

function choiceKey(value: ChoiceValue): string {
  return `${typeof value}:${String(value)}`;
}

function seededWinner<T>(values: T[], seed: string): T | undefined {
  if (values.length === 0) return undefined;
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return values[Math.abs(hash >>> 0) % values.length];
}

function nowDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export class GameRoom {
  readonly roomId: string;
  readonly timings: RoomTimings;

  private hooks: RoomHooks;
  private players = new Map<string, PlayerSession>();
  private eligibleSessions = new Set<string>();
  private slotVotes = new Map<string, Map<string, ChoiceValue>>();
  private history: Array<{
    mapId: string;
    mode: GameMode;
    success: boolean;
    connectedPlayers: number;
    endedAt: number;
  }> = [];

  private map: GameMap = GAME_MAPS[0]!;
  private mode: GameMode = "COCODE";
  private phase: RoundPhase = "ATTRACT";
  private previousPhase: RoundPhase | undefined;
  private phaseStartedAt = Date.now();
  private phaseEndsAt = 0;
  private pausedRemainingMs = 0;
  private pausedElapsedMs = 0;
  private roundId: string = randomUUID();
  private startedAt = Date.now();
  private maxConnectedPlayers = 0;
  private currentSlotIndex = 0;
  private authoringStage: "VOTE" | "REVEAL" = "VOTE";
  private lockedChoices: Record<string, ChoiceValue> = {};
  private program: ProgramNode[] = [];
  private execution: ExecutionResult | undefined;

  constructor(
    roomId: string,
    hooks: Partial<RoomHooks> = {},
    timings: Partial<RoomTimings> = {},
  ) {
    this.roomId = roomId;
    this.hooks = { ...noOpHooks, ...hooks };
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  get connectedPlayers(): number {
    const now = Date.now();
    return [...this.players.values()].filter((player) => player.connected || now - player.lastSeenAt <= 10_000).length;
  }

  get currentPhase(): RoundPhase {
    return this.phase;
  }

  get currentMapId(): string {
    return this.map.id;
  }

  get currentRoundId(): string {
    return this.roundId;
  }

  start(options: AdminStartOptions = {}): void {
    const requestedMode = options.mode ?? "COCODE";
    const requestedMap = options.mapId ? getMapById(options.mapId) : undefined;
    if (options.mapId && !requestedMap) throw new Error(`Unknown map: ${options.mapId}`);
    if (requestedMap && !requestedMap.mode.includes(requestedMode)) {
      throw new Error(`Map ${requestedMap.id} does not support mode ${requestedMode}`);
    }
    const fallback = requestedMap ?? chooseNextRound(this.history, this.connectedPlayers, randomUUID()).map;
    this.beginRound(fallback, requestedMode);
  }

  restore(checkpoint: RoomCheckpoint): boolean {
    if (checkpoint.version !== 1 || checkpoint.roomId !== this.roomId) return false;
    const restoredMap = getMapById(checkpoint.mapId);
    if (!restoredMap) return false;

    this.map = restoredMap;
    this.mode = checkpoint.mode;
    this.roundId = checkpoint.roundId;
    this.startedAt = checkpoint.startedAt;
    this.lockedChoices = { ...checkpoint.lockedChoices };
    this.currentSlotIndex = checkpoint.currentSlotIndex;
    this.phase = checkpoint.phase;

    const compiled = compileProgram(this.map.template, this.lockedChoices, this.map.maxSteps);
    if (compiled.ok) {
      this.program = compiled.program;
      this.execution = executeProgram(this.map, this.program);
    }

    if (this.phase === "AUTHORING") this.openAuthoringSlot(Date.now());
    else if (this.phase === "EXECUTE") this.enterExecution();
    else this.setPhase("JOIN", this.timings.joinMs, "restored-safe-boundary");
    this.hooks.onSystemEvent("room.restored", { roomId: this.roomId, roundId: this.roundId });
    return true;
  }

  connectPlayer(sessionId: string): { isNew: boolean } {
    const now = Date.now();
    const existing = this.players.get(sessionId);
    const isNew = !existing;
    this.players.set(sessionId, {
      connected: true,
      joinedAt: existing?.joinedAt ?? now,
      lastSeenAt: now,
    });
    this.maxConnectedPlayers = Math.max(this.maxConnectedPlayers, this.connectedPlayers);
    if (isNew) this.hooks.onDailyIncrement({ participantSessions: 1 });
    if (this.phase === "AUTHORING" && this.authoringStage === "VOTE" && this.phaseEndsAt - now >= 2_000) {
      this.eligibleSessions.add(sessionId);
    }
    this.emit("player-connected");
    return { isNew };
  }

  disconnectPlayer(sessionId: string): void {
    const existing = this.players.get(sessionId);
    if (!existing) return;
    existing.connected = false;
    existing.lastSeenAt = Date.now();
    this.emit("player-disconnected");
  }

  touchPlayer(sessionId: string): void {
    const existing = this.players.get(sessionId);
    if (existing) existing.lastSeenAt = Date.now();
  }

  castVote(sessionId: string, slotId: string, value: ChoiceValue): { ok: boolean; reason?: string } {
    const now = Date.now();
    if (this.phase !== "AUTHORING" || this.authoringStage !== "VOTE") return { ok: false, reason: "当前不是编程投票阶段" };
    if (this.phaseEndsAt - now <= 1_000) return { ok: false, reason: "本步已经锁票" };
    const slot = this.currentSlot();
    if (!slot || slot.slotId !== slotId) return { ok: false, reason: "不是当前程序空位" };
    if (!slot.options.some((option) => choicesEqual(option, value))) return { ok: false, reason: "非法选项" };
    if (!this.players.get(sessionId)?.connected) return { ok: false, reason: "会话未连接" };
    this.eligibleSessions.add(sessionId);
    const votes = this.slotVotes.get(slotId) ?? new Map<string, ChoiceValue>();
    votes.set(sessionId, value);
    this.slotVotes.set(slotId, votes);
    this.touchPlayer(sessionId);
    this.emit("vote-cast");
    return { ok: true };
  }

  pause(): void {
    if (this.phase === "PAUSED") return;
    const now = Date.now();
    this.previousPhase = this.phase;
    this.pausedRemainingMs = Math.max(0, this.phaseEndsAt - now);
    this.pausedElapsedMs = Math.max(0, now - this.phaseStartedAt);
    this.phase = "PAUSED";
    this.phaseStartedAt = now;
    this.phaseEndsAt = 0;
    this.emit("admin-pause", true);
  }

  resume(): void {
    if (this.phase !== "PAUSED" || !this.previousPhase) return;
    const previous = this.previousPhase;
    this.previousPhase = undefined;
    this.phase = previous;
    const now = Date.now();
    this.phaseStartedAt = now - this.pausedElapsedMs;
    this.phaseEndsAt = now + Math.max(1_000, this.pausedRemainingMs);
    this.emit("admin-resume", true);
  }

  reset(options: AdminStartOptions = {}): void {
    this.hooks.onSystemEvent("admin.reset", { roomId: this.roomId, phase: this.phase, mapId: this.map.id });
    this.start(options);
  }

  skipPhase(): void {
    if (this.phase === "PAUSED" || this.phase === "ATTRACT") return;
    this.hooks.onSystemEvent("admin.skip", { roomId: this.roomId, phase: this.phase });
    this.phaseEndsAt = Date.now();
    this.tick(Date.now());
  }

  updateTimings(values: Partial<RoomTimings>): void {
    const names: (keyof RoomTimings)[] = [
      "joinMs", "voteMs", "revealMs", "compileMs",
    ];
    for (const name of names) {
      const value = values[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        this.timings[name] = Math.min(30_000, Math.max(1_000, value));
      }
    }
    this.emit("admin-timing-update", true);
  }

  tick(now = Date.now()): void {
    this.pruneDisconnected(now);
    if (this.phase === "PAUSED" || this.phase === "ATTRACT" || this.phaseEndsAt > now) return;

    if (this.phase === "JOIN") {
      this.openAuthoringSlot(now);
    } else if (this.phase === "AUTHORING") {
      if (this.authoringStage === "VOTE") this.lockCurrentSlot(now);
      else this.advanceAuthoring(now);
    } else if (this.phase === "COMPILE") this.enterExecution();
    else if (this.phase === "EXECUTE") this.finishExecution();
  }

  snapshot(now = Date.now()): PublicRoundState {
    const state: PublicRoundState = {
      roomId: this.roomId,
      roundId: this.roundId,
      mode: this.mode,
      phase: this.phase,
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: now,
      connectedPlayers: this.connectedPlayers,
      map: publicMap(this.map),
      slots: collectSlots(this.map.template),
      currentSlotIndex: this.currentSlotIndex,
      lockedChoices: { ...this.lockedChoices },
      trace: this.execution?.trace ?? [],
    };
    if (this.previousPhase) state.previousPhase = this.previousPhase;
    const tally = this.currentTally(now);
    if (tally) state.currentTally = tally;
    return state;
  }

  sessionState(sessionId: string): { selectedVote?: ChoiceValue } {
    const value: { selectedVote?: ChoiceValue } = {};
    const currentSlot = this.currentSlot();
    if (currentSlot) {
      const selectedVote = this.slotVotes.get(currentSlot.slotId)?.get(sessionId);
      if (selectedVote !== undefined) value.selectedVote = selectedVote;
    }
    return value;
  }

  checkpoint(): RoomCheckpoint {
    const checkpoint: RoomCheckpoint = {
      version: 1,
      roomId: this.roomId,
      roundId: this.roundId,
      mode: this.mode,
      mapId: this.map.id,
      phase: this.phase,
      lockedChoices: { ...this.lockedChoices },
      currentSlotIndex: this.currentSlotIndex,
      startedAt: this.startedAt,
    };
    return checkpoint;
  }

  private beginRound(map: GameMap, mode: GameMode): void {
    this.map = map;
    this.mode = mode;
    this.roundId = randomUUID();
    this.startedAt = Date.now();
    this.maxConnectedPlayers = this.connectedPlayers;
    this.currentSlotIndex = 0;
    this.authoringStage = "VOTE";
    this.slotVotes.clear();
    this.eligibleSessions.clear();
    this.lockedChoices = {};
    this.program = [];
    this.execution = undefined;
    this.setPhase("JOIN", this.timings.joinMs, "round-started");
  }

  private currentSlot(): ProgramSlot | undefined {
    return collectSlots(this.map.template)[this.currentSlotIndex];
  }

  private openAuthoringSlot(now: number): void {
    const slot = this.currentSlot();
    if (!slot) {
      this.beginCompile("all-slots-authored");
      return;
    }
    this.authoringStage = "VOTE";
    this.eligibleSessions = new Set(
      [...this.players.entries()].filter(([, player]) => player.connected).map(([id]) => id),
    );
    this.phase = "AUTHORING";
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + this.timings.voteMs;
    this.emit("authoring-slot-opened", true);
  }

  private lockCurrentSlot(now: number): void {
    const slot = this.currentSlot();
    if (!slot) {
      this.beginCompile("authoring-slot-missing");
      return;
    }
    const tally = this.tallyValues(slot.options, this.slotVotes.get(slot.slotId)?.values() ?? []);
    const winner = this.pickWinner(tally, `${this.roundId}:${slot.slotId}`)
      ?? this.map.standardChoices[slot.slotId]
      ?? slot.options[0];
    if (winner === undefined) throw new Error(`Slot ${slot.slotId} has no options`);
    this.lockedChoices[slot.slotId] = winner;
    const submitted = this.slotVotes.get(slot.slotId)?.size ?? 0;
    this.hooks.onDailyIncrement({ commandsSubmitted: submitted, cityEnergy: submitted });
    this.authoringStage = "REVEAL";
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + this.timings.revealMs;
    this.emit("authoring-slot-locked", true);
  }

  private advanceAuthoring(now: number): void {
    this.currentSlotIndex += 1;
    this.openAuthoringSlot(now);
  }

  private beginCompile(reason: string): void {
    const compiled = compileProgram(this.map.template, this.lockedChoices, this.map.maxSteps);
    if (!compiled.ok) {
      this.program = compiled.program;
      this.execution = {
        success: false,
        state: { ...this.map.start, activeSwitches: [], collectedChips: [] },
        trace: [],
        failureType: "COMPILE",
        failureLine: compiled.issues[0]?.line ?? 1,
        executedActionCount: 0,
        collectedAllChips: false,
      };
    } else {
      this.program = compiled.program;
      this.execution = executeProgram(this.map, this.program);
    }
    this.setPhase("COMPILE", this.timings.compileMs, reason);
  }

  private enterExecution(): void {
    if (!this.execution) {
      this.beginCompile("execution-required-recompile");
      return;
    }
    const duration = Math.min(16_000, Math.max(1_000, traceDuration(this.execution.trace) + 250));
    this.setPhase("EXECUTE", duration, "execution-started");
  }

  private finishExecution(): void {
    const success = this.execution?.success ?? false;
    const endedAt = Date.now();
    this.history.push({
      mapId: this.map.id,
      mode: this.mode,
      success,
      connectedPlayers: this.maxConnectedPlayers,
      endedAt,
    });
    this.history = this.history.slice(-20);
    this.hooks.onRoundComplete({
      roundId: this.roundId,
      roomId: this.roomId,
      mapId: this.map.id,
      mode: this.mode,
      startedAt: this.startedAt,
      endedAt,
      connectedPlayers: this.maxConnectedPlayers,
      success,
      choices: Object.fromEntries(Object.entries(this.lockedChoices).map(([key, value]) => [key, value])),
    });
    this.hooks.onDailyIncrement({
      roundsPlayed: 1,
      successfulDeliveries: success ? 1 : 0,
    });
    this.startNextDirectedRound();
  }

  private startNextDirectedRound(): void {
    const decision = chooseNextRound(this.history, this.connectedPlayers, randomUUID());
    this.hooks.onSystemEvent("director.decision", {
      roomId: this.roomId,
      mode: decision.mode,
      mapId: decision.map.id,
      reason: decision.reason,
    });
    this.beginRound(decision.map, decision.mode);
  }

  private currentTally(now: number): VoteTally | undefined {
    if (this.phase === "AUTHORING") {
      const slot = this.currentSlot();
      if (!slot) return undefined;
      const votes = this.slotVotes.get(slot.slotId);
      const raw = this.tallyValues(slot.options, votes?.values() ?? []);
      const totalDuration = this.authoringStage === "VOTE" ? this.timings.voteMs : this.timings.revealMs;
      const distributionVisible = this.authoringStage === "REVEAL" || now >= this.phaseStartedAt + totalDuration * 0.6;
      const winner = this.authoringStage === "REVEAL" ? this.lockedChoices[slot.slotId] : undefined;
      const tally: VoteTally = {
        slotId: slot.slotId,
        options: raw.map(({ value, count }) => ({ value, count: distributionVisible ? count : 0 })),
        eligibleCount: this.eligibleSessions.size,
        submittedCount: votes?.size ?? 0,
        locked: this.authoringStage === "REVEAL",
      };
      if (winner !== undefined) tally.winner = winner;
      return tally;
    }

    return undefined;
  }

  private tallyValues(options: ChoiceValue[], values: Iterable<ChoiceValue>): Array<{ value: ChoiceValue; count: number }> {
    const counts = new Map(options.map((option) => [choiceKey(option), 0]));
    for (const value of values) counts.set(choiceKey(value), (counts.get(choiceKey(value)) ?? 0) + 1);
    return options.map((value) => ({ value, count: counts.get(choiceKey(value)) ?? 0 }));
  }

  private pickWinner(tally: Array<{ value: ChoiceValue; count: number }>, seed: string): ChoiceValue | undefined {
    const highest = Math.max(0, ...tally.map((entry) => entry.count));
    if (highest === 0) return undefined;
    const tied = tally.filter((entry) => entry.count === highest).map((entry) => entry.value);
    return seededWinner(tied, seed);
  }

  private setPhase(phase: RoundPhase, durationMs: number, reason: string): void {
    const now = Date.now();
    this.phase = phase;
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + durationMs;
    this.emit(reason, true);
  }

  private emit(reason: string, checkpoint = false): void {
    this.maxConnectedPlayers = Math.max(this.maxConnectedPlayers, this.connectedPlayers);
    this.hooks.onChange(this.snapshot(), reason);
    if (checkpoint) this.hooks.onCheckpoint(this.checkpoint());
  }

  private pruneDisconnected(now: number): void {
    let changed = false;
    for (const [sessionId, player] of this.players) {
      if (!player.connected && now - player.lastSeenAt > 10 * 60_000) {
        this.players.delete(sessionId);
        changed = true;
      }
    }
    if (changed) this.emit("expired-sessions-pruned");
  }
}

export function shanghaiDate(): string {
  return nowDate();
}

import { randomUUID } from "node:crypto";
import {
  GAME_MAPS,
  chooseNextRound,
  collectSlots,
  compileProgram,
  coreBattleMaps,
  debugCandidateSlots,
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
  type RoundScore,
  type VoteTally,
} from "@codegame/game-core";
import type { PersistedRound } from "./database.js";

export interface RoomTimings {
  joinMs: number;
  briefingMs: number;
  voteMs: number;
  revealMs: number;
  compileMs: number;
  predictMs: number;
  debugSelectMs: number;
  debugPatchMs: number;
  emergencyPatchMs: number;
  resultMs: number;
  resetMs: number;
}

export const DEFAULT_TIMINGS: RoomTimings = {
  joinMs: 10_000,
  briefingMs: 10_000,
  voteMs: 10_000,
  revealMs: 3_000,
  compileMs: 3_000,
  predictMs: 10_000,
  debugSelectMs: 10_000,
  debugPatchMs: 10_000,
  emergencyPatchMs: 10_000,
  resultMs: 10_000,
  resetMs: 3_000,
};

interface PlayerSession {
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

type Prediction = "success" | "crash" | "incomplete";

export interface RoomCheckpoint {
  version: 1;
  roomId: string;
  roundId: string;
  mode: GameMode;
  mapId: string;
  phase: RoundPhase;
  lockedChoices: Record<string, ChoiceValue>;
  currentSlotIndex: number;
  collaborationEnergy: number;
  debugAttempts: number;
  selectedDebugSlot?: string;
  showcaseStage: number;
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
  private debugLineVotes = new Map<string, string>();
  private debugPatchVotes = new Map<string, ChoiceValue>();
  private predictionVotes = new Map<string, Prediction>();
  private predictionOutcome: Prediction | undefined;
  private history: Array<{
    mapId: string;
    mode: GameMode;
    firstRunSuccess: boolean;
    finalSuccess: boolean;
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
  private collaborationEnergy = 0;
  private highParticipationWindows = 0;
  private totalParticipationWindows = 0;
  private allCommitted = true;
  private program: ProgramNode[] = [];
  private execution: ExecutionResult | undefined;
  private solutionExecution: ExecutionResult | undefined;
  private solutionChoices: Record<string, ChoiceValue> | undefined;
  private firstRunSuccess = false;
  private debugCandidates: string[] = [];
  private selectedDebugSlot: string | undefined;
  private debugAttempts = 0;
  private score: RoundScore | undefined;
  private resultMessage: string | undefined;
  private showcaseStage = 0;
  private roundRecorded = false;

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
    if (requestedMode === "CORE_BATTLE") {
      const maps = coreBattleMaps();
      this.showcaseStage = 0;
      this.beginRound(maps[0] ?? this.map, "CORE_BATTLE", true);
      return;
    }

    const requestedMap = options.mapId ? getMapById(options.mapId) : undefined;
    if (options.mapId && !requestedMap) throw new Error(`Unknown map: ${options.mapId}`);
    if (requestedMap && !requestedMap.mode.includes(requestedMode)) {
      throw new Error(`Map ${requestedMap.id} does not support mode ${requestedMode}`);
    }
    const fallback = requestedMap ?? chooseNextRound(this.history, this.connectedPlayers, randomUUID()).map;
    this.showcaseStage = 0;
    this.beginRound(fallback, requestedMode, true);
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
    this.collaborationEnergy = checkpoint.collaborationEnergy;
    this.debugAttempts = checkpoint.debugAttempts;
    this.selectedDebugSlot = checkpoint.selectedDebugSlot;
    this.showcaseStage = checkpoint.showcaseStage;
    this.phase = checkpoint.phase;

    const compiled = compileProgram(this.map.template, this.lockedChoices, this.map.maxSteps);
    if (compiled.ok) {
      this.program = compiled.program;
      this.execution = executeProgram(this.map, this.program);
      this.debugCandidates = debugCandidateSlots(this.program, this.execution);
    }

    if (this.phase === "AUTHORING") this.openAuthoringSlot(Date.now());
    else if (this.phase === "EXECUTE" || this.phase === "REEXECUTE") this.enterExecution(this.phase);
    else if (this.phase === "RESULT") this.setPhase("RESULT", this.timings.resultMs, "restored-result");
    else this.setPhase("BRIEFING", this.timings.briefingMs, "restored-safe-boundary");
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

  castPrediction(sessionId: string, prediction: Prediction): { ok: boolean; reason?: string } {
    if (this.phase !== "PREDICT") return { ok: false, reason: "当前不是预测阶段" };
    if (!(["success", "crash", "incomplete"] as string[]).includes(prediction)) return { ok: false, reason: "非法预测" };
    this.predictionVotes.set(sessionId, prediction);
    this.emit("prediction-cast");
    return { ok: true };
  }

  castDebugLine(sessionId: string, slotId: string): { ok: boolean; reason?: string } {
    if (this.phase !== "DEBUG_SELECT") return { ok: false, reason: "当前不是选择可疑行阶段" };
    if (this.phaseEndsAt - Date.now() <= 1_000) return { ok: false, reason: "本步已经锁票" };
    if (!this.debugCandidates.includes(slotId)) return { ok: false, reason: "该行不在候选范围" };
    this.debugLineVotes.set(sessionId, slotId);
    this.emit("debug-line-cast");
    return { ok: true };
  }

  castDebugPatch(sessionId: string, slotId: string, value: ChoiceValue): { ok: boolean; reason?: string } {
    if (this.phase !== "DEBUG_PATCH") return { ok: false, reason: "当前不是提交补丁阶段" };
    if (this.phaseEndsAt - Date.now() <= 1_000) return { ok: false, reason: "本步已经锁票" };
    if (this.selectedDebugSlot !== slotId) return { ok: false, reason: "不是当前补丁行" };
    const slot = this.debugPatchSlot();
    if (!slot?.options.some((option) => choicesEqual(option, value))) return { ok: false, reason: "非法补丁" };
    this.debugPatchVotes.set(sessionId, value);
    this.emit("debug-patch-cast");
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
      "joinMs", "briefingMs", "voteMs", "revealMs", "compileMs", "predictMs",
      "debugSelectMs", "debugPatchMs", "emergencyPatchMs", "resultMs", "resetMs",
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

    if (this.phase === "JOIN") this.setPhase("BRIEFING", this.timings.briefingMs, "join-complete");
    else if (this.phase === "BRIEFING") {
      if (this.mode === "BUG_CLINIC") {
        this.lockedChoices = { ...this.map.buggyChoices };
        this.beginCompile("bug-program-loaded");
      } else this.openAuthoringSlot(now);
    } else if (this.phase === "AUTHORING") {
      if (this.authoringStage === "VOTE") this.lockCurrentSlot(now);
      else this.advanceAuthoring(now);
    } else if (this.phase === "COMPILE") this.setPhase("PREDICT", this.timings.predictMs, "compile-complete");
    else if (this.phase === "PREDICT") this.enterExecution("EXECUTE");
    else if (this.phase === "EXECUTE" || this.phase === "REEXECUTE") this.finishExecution();
    else if (this.phase === "DEBUG_SELECT") this.lockDebugLine(now);
    else if (this.phase === "DEBUG_PATCH") this.lockDebugPatch(now);
    else if (this.phase === "RESULT") this.afterResult();
    else if (this.phase === "RESET") this.startNextDirectedRound();
  }

  snapshot(now = Date.now()): PublicRoundState {
    const predictionCounts = { success: 0, crash: 0, incomplete: 0 };
    if (this.phase !== "PREDICT") {
      for (const prediction of this.predictionVotes.values()) predictionCounts[prediction] += 1;
    }
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
      collaborationEnergy: this.collaborationEnergy,
      trace: this.execution?.trace ?? [],
      debugCandidateSlots: [...this.debugCandidates],
      debugAttempts: this.debugAttempts,
      predictions: predictionCounts,
      showcaseStage: this.showcaseStage,
      showcaseTotalStages: this.mode === "CORE_BATTLE" ? coreBattleMaps().length : 1,
    };
    if (this.previousPhase) state.previousPhase = this.previousPhase;
    const tally = this.currentTally(now);
    if (tally) state.currentTally = tally;
    if (this.execution) state.execution = this.execution;
    if (this.solutionExecution) state.solutionTrace = this.solutionExecution.trace;
    if (this.solutionChoices) state.solutionChoices = { ...this.solutionChoices };
    if (this.selectedDebugSlot) state.selectedDebugSlot = this.selectedDebugSlot;
    if (this.score) state.score = this.score;
    if (this.predictionOutcome) state.predictionOutcome = this.predictionOutcome;
    if (this.resultMessage) state.resultMessage = this.resultMessage;
    return state;
  }

  sessionState(sessionId: string): {
    selectedVote?: ChoiceValue;
    selectedPrediction?: Prediction;
    selectedDebugLine?: string;
    selectedDebugPatch?: ChoiceValue;
  } {
    const value: {
      selectedVote?: ChoiceValue;
      selectedPrediction?: Prediction;
      selectedDebugLine?: string;
      selectedDebugPatch?: ChoiceValue;
    } = {};
    const currentSlot = this.currentSlot();
    if (currentSlot) {
      const selectedVote = this.slotVotes.get(currentSlot.slotId)?.get(sessionId);
      if (selectedVote !== undefined) value.selectedVote = selectedVote;
    }
    const prediction = this.predictionVotes.get(sessionId);
    if (prediction) value.selectedPrediction = prediction;
    const debugLine = this.debugLineVotes.get(sessionId);
    if (debugLine) value.selectedDebugLine = debugLine;
    const debugPatch = this.debugPatchVotes.get(sessionId);
    if (debugPatch !== undefined) value.selectedDebugPatch = debugPatch;
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
      collaborationEnergy: this.collaborationEnergy,
      debugAttempts: this.debugAttempts,
      showcaseStage: this.showcaseStage,
      startedAt: this.startedAt,
    };
    if (this.selectedDebugSlot) checkpoint.selectedDebugSlot = this.selectedDebugSlot;
    return checkpoint;
  }

  private beginRound(map: GameMap, mode: GameMode, includeJoin: boolean): void {
    this.map = map;
    this.mode = mode;
    this.roundId = randomUUID();
    this.startedAt = Date.now();
    this.maxConnectedPlayers = this.connectedPlayers;
    this.currentSlotIndex = 0;
    this.authoringStage = "VOTE";
    this.slotVotes.clear();
    this.debugLineVotes.clear();
    this.debugPatchVotes.clear();
    this.predictionVotes.clear();
    this.eligibleSessions.clear();
    this.lockedChoices = {};
    this.collaborationEnergy = 0;
    this.highParticipationWindows = 0;
    this.totalParticipationWindows = 0;
    this.allCommitted = true;
    this.program = [];
    this.execution = undefined;
    this.solutionExecution = undefined;
    this.solutionChoices = undefined;
    this.firstRunSuccess = false;
    this.predictionOutcome = undefined;
    this.debugCandidates = [];
    this.selectedDebugSlot = undefined;
    this.debugAttempts = 0;
    this.score = undefined;
    this.resultMessage = undefined;
    this.roundRecorded = false;
    this.setPhase(includeJoin ? "JOIN" : "BRIEFING", includeJoin ? this.timings.joinMs : this.timings.briefingMs, "round-started");
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
    const eligible = this.eligibleSessions.size;
    const participation = eligible > 0 ? submitted / eligible : 0;
    this.totalParticipationWindows += 1;
    if (participation >= 0.7) {
      this.highParticipationWindows += 1;
      this.collaborationEnergy = Math.min(3, this.collaborationEnergy + 1);
    }
    if (eligible === 0 || submitted < eligible) this.allCommitted = false;
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
      this.resultMessage = compiled.issues[0]?.message ?? "程序编译失败";
      this.enterResult(false);
      return;
    }
    this.program = compiled.program;
    this.execution = executeProgram(this.map, this.program);
    this.setPhase("COMPILE", this.timings.compileMs, reason);
  }

  private enterExecution(phase: "EXECUTE" | "REEXECUTE"): void {
    if (!this.execution) {
      this.beginCompile("execution-required-recompile");
      return;
    }
    if (phase === "EXECUTE") {
      this.predictionOutcome = this.execution.success
        ? "success"
        : this.execution.failureType === "COLLISION" || this.execution.failureType === "OUT_OF_BOUNDS" || this.execution.failureType === "MECHANISM"
          ? "crash"
          : "incomplete";
    }
    const duration = Math.min(16_000, Math.max(10_000, traceDuration(this.execution.trace) + 1_000));
    this.setPhase(phase, duration, phase === "EXECUTE" ? "execution-started" : "reexecution-started");
  }

  private finishExecution(): void {
    if (!this.execution) {
      this.enterResult(false);
      return;
    }
    if (this.phase === "EXECUTE") this.firstRunSuccess = this.execution.success;
    if (this.execution.success) {
      if (this.debugAttempts > 0) this.hooks.onDailyIncrement({ bugsFixed: 1 });
      this.enterResult(true);
      return;
    }

    if (this.phase === "REEXECUTE" && this.debugAttempts >= 1) {
      if (this.debugAttempts === 1 && this.collaborationEnergy >= 3) {
        this.debugCandidates = debugCandidateSlots(this.program, this.execution);
        this.selectedDebugSlot = this.debugCandidates[0];
        this.debugPatchVotes.clear();
        this.setPhase("DEBUG_PATCH", this.timings.emergencyPatchMs, "emergency-patch-unlocked");
      } else this.enterResult(false);
      return;
    }

    this.debugCandidates = debugCandidateSlots(this.program, this.execution);
    this.debugLineVotes.clear();
    this.selectedDebugSlot = undefined;
    this.setPhase("DEBUG_SELECT", this.timings.debugSelectMs, "debug-select-opened");
  }

  private lockDebugLine(now: number): void {
    const counts = new Map<string, number>();
    for (const slotId of this.debugLineVotes.values()) counts.set(slotId, (counts.get(slotId) ?? 0) + 1);
    const highest = Math.max(0, ...counts.values());
    const tied = this.debugCandidates.filter((slotId) => (counts.get(slotId) ?? 0) === highest);
    this.selectedDebugSlot = seededWinner(tied, `${this.roundId}:debug:${this.debugAttempts}`) ?? this.debugCandidates[0];
    if (!this.selectedDebugSlot) {
      this.enterResult(false);
      return;
    }
    this.debugPatchVotes.clear();
    this.phase = "DEBUG_PATCH";
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + this.timings.debugPatchMs;
    this.emit("debug-line-locked", true);
  }

  private lockDebugPatch(_now: number): void {
    const slot = this.debugPatchSlot();
    if (!slot || !this.selectedDebugSlot) {
      this.enterResult(false);
      return;
    }
    const tally = this.tallyValues(slot.options, this.debugPatchVotes.values());
    const winner = this.pickWinner(tally, `${this.roundId}:patch:${this.debugAttempts}`)
      ?? this.map.standardChoices[this.selectedDebugSlot]
      ?? slot.options[0];
    if (winner === undefined) {
      this.enterResult(false);
      return;
    }
    this.lockedChoices[this.selectedDebugSlot] = winner;
    this.debugAttempts += 1;
    const compiled = compileProgram(this.map.template, this.lockedChoices, this.map.maxSteps);
    if (!compiled.ok) {
      this.resultMessage = compiled.issues[0]?.message ?? "补丁无法编译";
      this.enterResult(false);
      return;
    }
    this.program = compiled.program;
    this.execution = executeProgram(this.map, this.program);
    this.enterExecution("REEXECUTE");
  }

  private debugPatchSlot(): ProgramSlot | undefined {
    if (!this.selectedDebugSlot) return undefined;
    const slot = collectSlots(this.map.template).find((candidate) => candidate.slotId === this.selectedDebugSlot);
    if (!slot) return undefined;
    const current = this.lockedChoices[slot.slotId];
    const alternatives = slot.options.filter((option) => current === undefined || !choicesEqual(option, current));
    return { ...slot, options: alternatives.length > 0 ? alternatives : slot.options };
  }

  private enterResult(success: boolean): void {
    const execution = this.execution;
    const collaborationRatio = this.totalParticipationWindows > 0
      ? this.highParticipationWindows / this.totalParticipationWindows
      : 0;
    const badges: RoundScore["badges"] = [];
    if (success && this.debugAttempts === 0) badges.push("FIRST_RUN");
    if (success && this.debugAttempts > 0) badges.push("BUG_HUNTER");
    if (this.allCommitted && this.totalParticipationWindows > 0) badges.push("ALL_COMMITTED");
    if (success && execution && execution.executedActionCount <= this.map.parSteps) badges.push("SHORTEST_PROGRAM");
    this.score = {
      missionStar: success,
      algorithmStar: Boolean(success && execution && execution.executedActionCount <= this.map.parSteps),
      collaborationStar: collaborationRatio >= 0.7,
      badges,
    };
    this.resultMessage = success
      ? this.debugAttempts > 0 ? "调试通过，机器人已安全抵达！" : "编译成功，机器人一次抵达！"
      : this.resultMessage ?? "本轮未通过，随后展示标准解。";
    if (!success) {
      const compiledSolution = compileProgram(this.map.template, this.map.standardChoices, this.map.maxSteps);
      if (compiledSolution.ok) {
        this.solutionChoices = { ...this.map.standardChoices };
        this.solutionExecution = executeProgram(this.map, compiledSolution.program);
      }
    }
    this.setPhase("RESULT", this.timings.resultMs, "round-result");

    if (!this.roundRecorded && (this.mode !== "CORE_BATTLE" || !success || this.showcaseStage === coreBattleMaps().length - 1)) {
      this.roundRecorded = true;
      const endedAt = Date.now();
      this.history.push({
        mapId: this.map.id,
        mode: this.mode,
        firstRunSuccess: this.firstRunSuccess,
        finalSuccess: success,
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
        firstRunSuccess: this.firstRunSuccess,
        finalSuccess: success,
        debugAttempts: this.debugAttempts,
        choices: Object.fromEntries(Object.entries(this.lockedChoices).map(([key, value]) => [key, value])),
        score: this.score,
      });
      this.hooks.onDailyIncrement({
        roundsPlayed: 1,
        successfulDeliveries: success ? 1 : 0,
      });
    }
  }

  private afterResult(): void {
    if (this.mode === "CORE_BATTLE" && this.execution?.success) {
      const maps = coreBattleMaps();
      if (this.showcaseStage < maps.length - 1) {
        this.showcaseStage += 1;
        const nextMap = maps[this.showcaseStage];
        if (nextMap) {
          this.beginRound(nextMap, "CORE_BATTLE", false);
          return;
        }
      }
    }
    this.setPhase("RESET", this.timings.resetMs, "result-complete");
  }

  private startNextDirectedRound(): void {
    const decision = chooseNextRound(this.history, this.connectedPlayers, randomUUID());
    this.hooks.onSystemEvent("director.decision", {
      roomId: this.roomId,
      mode: decision.mode,
      mapId: decision.map.id,
      reason: decision.reason,
    });
    this.showcaseStage = 0;
    this.beginRound(decision.map, decision.mode, true);
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

    if (this.phase === "DEBUG_PATCH") {
      const slot = this.debugPatchSlot();
      if (!slot) return undefined;
      return {
        slotId: slot.slotId,
        options: this.tallyValues(slot.options, this.debugPatchVotes.values()),
        eligibleCount: this.connectedPlayers,
        submittedCount: this.debugPatchVotes.size,
        locked: false,
      };
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

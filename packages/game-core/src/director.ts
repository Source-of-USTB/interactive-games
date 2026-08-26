import { GAME_MAPS, mapsForMode } from "./maps.js";
import type { GameMap, GameMode } from "./types.js";

export interface RoundHistoryEntry {
  mapId: string;
  mode: GameMode;
  firstRunSuccess: boolean;
  finalSuccess: boolean;
  connectedPlayers: number;
  endedAt: number;
}

export interface DirectorDecision {
  mode: GameMode;
  map: GameMap;
  reason: string;
}

function seededIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

function recentStreak(history: RoundHistoryEntry[], predicate: (entry: RoundHistoryEntry) => boolean): number {
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || !predicate(entry)) break;
    streak += 1;
  }
  return streak;
}

export function chooseNextRound(
  history: RoundHistoryEntry[],
  connectedPlayers: number,
  seed: string,
): DirectorDecision {
  const recent = history.slice(-5);
  const recentMapIds = new Set(history.slice(-4).map((entry) => entry.mapId));
  const firstRunStreak = recentStreak(history, (entry) => entry.firstRunSuccess);
  const failedStreak = recentStreak(history, (entry) => !entry.finalSuccess);
  const roundsSinceBugClinic = [...history].reverse().findIndex((entry) => entry.mode === "BUG_CLINIC");

  let mode: GameMode = "COCODE";
  let targetDifficulty = 2;
  let reason = "保持默认共同编程节奏";

  if (roundsSinceBugClinic < 0 || roundsSinceBugClinic >= 2) {
    mode = "BUG_CLINIC";
    targetDifficulty = 2 + Math.min(2, Math.floor(history.length / 4));
    reason = "轮换到 Bug 急诊室，确保出现调试体验";
  } else if (failedStreak >= 2) {
    mode = "COCODE";
    targetDifficulty = 1;
    reason = "连续两轮未通过，回到启动区恢复节奏";
  } else if (connectedPlayers >= 8 && firstRunStreak >= 2) {
    mode = "LOGIC_LAB";
    targetDifficulty = 4;
    reason = "连续首次通关且参与人数充足，进入逻辑实验室";
  } else if (firstRunStreak >= 2) {
    targetDifficulty = 3;
    reason = "连续首次通关，提高一级难度";
  } else if (recent.some((entry) => entry.mode === "LOGIC_LAB")) {
    targetDifficulty = 2;
    reason = "逻辑关后回到基础共同编程轮次";
  }

  const modeMaps = mapsForMode(mode);
  const unrepeated = modeMaps.filter((map) => !recentMapIds.has(map.id));
  const pool = unrepeated.length > 0 ? unrepeated : modeMaps;
  const distance = (map: GameMap) => Math.abs(map.difficulty - targetDifficulty);
  const bestDistance = Math.min(...pool.map(distance));
  const best = pool.filter((map) => distance(map) === bestDistance);
  const map = best[seededIndex(seed, best.length)] ?? GAME_MAPS[0];
  if (!map) throw new Error("No game maps are configured");

  return { mode, map, reason };
}

export function coreBattleMaps(): GameMap[] {
  return GAME_MAPS.filter((map) => map.mode.includes("CORE_BATTLE")).sort((a, b) => a.id.localeCompare(b.id));
}

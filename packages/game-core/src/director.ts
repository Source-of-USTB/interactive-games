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
  const mode: GameMode = "COCODE";
  let targetDifficulty = 2;
  let reason = "保持默认共同编程节奏";

  if (failedStreak >= 2) {
    targetDifficulty = 1;
    reason = "连续两轮未通过，回到启动区恢复节奏";
  } else if (connectedPlayers >= 8 && firstRunStreak >= 2) {
    targetDifficulty = 2;
    reason = "连续首次通关，继续基础共同编程轮次";
  } else if (firstRunStreak >= 2) {
    targetDifficulty = 3;
    reason = "连续首次通关，提高一级难度";
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

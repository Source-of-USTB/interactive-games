import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GameDatabase } from "./database.js";

describe("GameDatabase", () => {
  it("omits retired daily stats while preserving legacy database values", () => {
    const directory = mkdtempSync(join(tmpdir(), "codegame-database-"));
    const path = join(directory, "game.sqlite");
    let database: GameDatabase | undefined;
    let legacy: DatabaseSync | undefined;

    try {
      legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE daily_stats (
          date TEXT PRIMARY KEY,
          participant_sessions INTEGER NOT NULL DEFAULT 0,
          commands_submitted INTEGER NOT NULL DEFAULT 0,
          bugs_fixed INTEGER NOT NULL DEFAULT 0,
          successful_deliveries INTEGER NOT NULL DEFAULT 0,
          rounds_played INTEGER NOT NULL DEFAULT 0,
          city_energy INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO daily_stats VALUES ('2026-09-06', 12, 30, 7, 2, 3, 99);
      `);
      database = new GameDatabase(path);
      expect(database.getDaily("2026-09-06")).toEqual({
        date: "2026-09-06",
        participantSessions: 12,
        commandsSubmitted: 30,
        successfulDeliveries: 2,
        roundsPlayed: 3,
      });
      expect(database.incrementDaily("2026-09-06", {
        participantSessions: 1,
        commandsSubmitted: 4,
        successfulDeliveries: 1,
        roundsPlayed: 1,
      })).toEqual({
        date: "2026-09-06",
        participantSessions: 13,
        commandsSubmitted: 34,
        successfulDeliveries: 3,
        roundsPlayed: 4,
      });
      expect(legacy.prepare(
        "SELECT bugs_fixed, city_energy FROM daily_stats WHERE date = ?",
      ).get("2026-09-06")).toEqual({ bugs_fixed: 7, city_energy: 99 });
      expect(database.getDaily("2026-09-07")).toEqual({
        date: "2026-09-07",
        participantSessions: 0,
        commandsSubmitted: 0,
        successfulDeliveries: 0,
        roundsPlayed: 0,
      });
    } finally {
      database?.close();
      legacy?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates legacy round scores to the single execution result", () => {
    const directory = mkdtempSync(join(tmpdir(), "codegame-database-"));
    const path = join(directory, "game.sqlite");

    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE rounds (
          round_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          map_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER NOT NULL,
          connected_players INTEGER NOT NULL,
          first_run_success INTEGER NOT NULL,
          final_success INTEGER NOT NULL,
          choices_json TEXT NOT NULL,
          score_json TEXT NOT NULL
        );
        INSERT INTO rounds VALUES (
          'legacy-round', 'MAIN', 'boot-01-first-route', 'COCODE',
          1, 2, 10, 1, 1, '{"s1":"MOVE"}', '{"missionStar":true}'
        );
      `);
      legacy.close();

      const database = new GameDatabase(path);
      expect(database.recentRounds()).toEqual([{
        roundId: "legacy-round",
        roomId: "MAIN",
        mapId: "boot-01-first-route",
        mode: "COCODE",
        startedAt: 1,
        endedAt: 2,
        connectedPlayers: 10,
        success: true,
        choices: { s1: "MOVE" },
      }]);
      database.close();

      const migrated = new DatabaseSync(path);
      const columns = migrated.prepare("PRAGMA table_info(rounds)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual([
        "round_id", "room_id", "map_id", "mode", "started_at", "ended_at",
        "connected_players", "success", "choices_json",
      ]);
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

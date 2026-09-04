import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DailyStats, GameMode } from "@codegame/game-core";

export interface PersistedRound {
  roundId: string;
  roomId: string;
  mapId: string;
  mode: GameMode;
  startedAt: number;
  endedAt: number;
  connectedPlayers: number;
  success: boolean;
  choices: Record<string, string | number>;
}

export class GameDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        room_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rounds (
        round_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        map_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        connected_players INTEGER NOT NULL,
        success INTEGER NOT NULL,
        choices_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        participant_sessions INTEGER NOT NULL DEFAULT 0,
        commands_submitted INTEGER NOT NULL DEFAULT 0,
        bugs_fixed INTEGER NOT NULL DEFAULT 0,
        successful_deliveries INTEGER NOT NULL DEFAULT 0,
        rounds_played INTEGER NOT NULL DEFAULT 0,
        city_energy INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
    `);
    this.migrateRounds();
  }

  private migrateRounds(): void {
    const columns = this.db.prepare("PRAGMA table_info(rounds)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "success")) return;
    this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE rounds RENAME TO rounds_legacy;
      CREATE TABLE rounds (
        round_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        map_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        connected_players INTEGER NOT NULL,
        success INTEGER NOT NULL,
        choices_json TEXT NOT NULL
      );
      INSERT INTO rounds (
        round_id, room_id, map_id, mode, started_at, ended_at, connected_players,
        success, choices_json
      )
      SELECT
        round_id, room_id, map_id, mode, started_at, ended_at, connected_players,
        final_success, choices_json
      FROM rounds_legacy;
      DROP TABLE rounds_legacy;
      COMMIT;
    `);
  }

  saveCheckpoint(roomId: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO checkpoints (room_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at
    `).run(roomId, JSON.stringify(value), Date.now());
  }

  loadCheckpoint<T>(roomId: string): T | undefined {
    const row = this.db.prepare("SELECT state_json FROM checkpoints WHERE room_id = ?").get(roomId) as
      | { state_json: string }
      | undefined;
    return row ? JSON.parse(row.state_json) as T : undefined;
  }

  recordRound(round: PersistedRound): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO rounds (
        round_id, room_id, map_id, mode, started_at, ended_at, connected_players,
        success, choices_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      round.roundId,
      round.roomId,
      round.mapId,
      round.mode,
      round.startedAt,
      round.endedAt,
      round.connectedPlayers,
      round.success ? 1 : 0,
      JSON.stringify(round.choices),
    );
  }

  incrementDaily(date: string, increments: Partial<Omit<DailyStats, "date">>): DailyStats {
    this.db.prepare("INSERT OR IGNORE INTO daily_stats (date) VALUES (?)").run(date);
    const columns: Record<keyof Omit<DailyStats, "date">, string> = {
      participantSessions: "participant_sessions",
      commandsSubmitted: "commands_submitted",
      bugsFixed: "bugs_fixed",
      successfulDeliveries: "successful_deliveries",
      roundsPlayed: "rounds_played",
      cityEnergy: "city_energy",
    };
    for (const [key, amount] of Object.entries(increments)) {
      if (typeof amount !== "number" || amount === 0) continue;
      const column = columns[key as keyof typeof columns];
      this.db.prepare(`UPDATE daily_stats SET ${column} = ${column} + ? WHERE date = ?`).run(amount, date);
    }
    return this.getDaily(date);
  }

  getDaily(date: string): DailyStats {
    this.db.prepare("INSERT OR IGNORE INTO daily_stats (date) VALUES (?)").run(date);
    const row = this.db.prepare("SELECT * FROM daily_stats WHERE date = ?").get(date) as Record<string, number | string>;
    return {
      date,
      participantSessions: Number(row.participant_sessions),
      commandsSubmitted: Number(row.commands_submitted),
      bugsFixed: Number(row.bugs_fixed),
      successfulDeliveries: Number(row.successful_deliveries),
      roundsPlayed: Number(row.rounds_played),
      cityEnergy: Number(row.city_energy),
    };
  }

  recordSystemEvent(eventType: string, details: unknown): void {
    this.db.prepare(
      "INSERT INTO system_events (occurred_at, event_type, details_json) VALUES (?, ?, ?)",
    ).run(Date.now(), eventType, JSON.stringify(details));
  }

  recentRounds(limit = 20): PersistedRound[] {
    const rows = this.db.prepare("SELECT * FROM rounds ORDER BY ended_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      roundId: String(row.round_id),
      roomId: String(row.room_id),
      mapId: String(row.map_id),
      mode: String(row.mode) as GameMode,
      startedAt: Number(row.started_at),
      endedAt: Number(row.ended_at),
      connectedPlayers: Number(row.connected_players),
      success: Boolean(row.success),
      choices: JSON.parse(String(row.choices_json)) as Record<string, string | number>,
    }));
  }

  exportRounds(limit = 10_000): PersistedRound[] {
    return this.recentRounds(Math.min(10_000, Math.max(1, limit)));
  }

  close(): void {
    this.db.close();
  }
}

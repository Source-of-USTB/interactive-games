import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { IncomingMessage as HttpIncomingMessage } from "node:http";
import type { ChoiceValue, GameMode, PublicRoundState } from "@codegame/game-core";
import { GAME_MAPS } from "@codegame/game-core";
import { createSessionToken, secureTokenMatches, verifySessionToken } from "./auth.js";
import { GameDatabase } from "./database.js";
import { GameRoom, shanghaiDate, type RoomCheckpoint, type RoomTimings } from "./game-room.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";

const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
  localOrigin: process.env.LOCAL_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
  adminToken: process.env.ADMIN_TOKEN ?? "development-admin-token",
  screenToken: process.env.SCREEN_TOKEN ?? process.env.ADMIN_TOKEN ?? "development-admin-token",
  sessionSecret: process.env.SESSION_SECRET ?? "development-session-secret-change-me",
  roomId: process.env.ROOM_ID ?? "MAIN",
  autoStart: process.env.AUTO_START !== "false",
  logLevel: process.env.LOG_LEVEL ?? "info",
  databasePath: process.env.DATABASE_PATH ?? resolve(process.cwd(), "runtime", "game.sqlite"),
  maxPlayers: Number(process.env.MAX_PLAYERS ?? 300),
};

type ClientRole = "player" | "screen" | "admin";

interface ConnectedClient {
  socket: WebSocket;
  role: ClientRole;
  sessionId?: string;
  connectedAt: number;
  lastPongAt: number;
  lastScreenAckAt?: number;
  lastScreenSequence?: number;
  observerOnly?: boolean;
  responses: Map<string, { type: string; payload: unknown }>;
}

interface DisplaySettings {
  qrMode: "public" | "local" | "hidden";
  masterVolume: number;
  effectsVolume: number;
  showVoteTrends: boolean;
  demoMode: boolean;
}

interface ClientMessage {
  type?: string;
  requestId?: string;
  slotId?: string;
  value?: ChoiceValue;
  prediction?: "success" | "crash" | "incomplete";
  command?: string;
  mapId?: string;
  mode?: GameMode;
  voteMs?: number;
  briefingMs?: number;
  joinMs?: number;
  revealMs?: number;
  compileMs?: number;
  predictMs?: number;
  resultMs?: number;
  resetMs?: number;
  sequence?: number;
  qrMode?: DisplaySettings["qrMode"];
  masterVolume?: number;
  effectsVolume?: number;
  showVoteTrends?: boolean;
  demoMode?: boolean;
}

const app = Fastify({ logger: false, trustProxy: ["127.0.0.1", "::1"] });
const serverLogDir = process.env.RUN_LOG_DIR ?? resolve(process.cwd(), "runtime", "logs", process.env.RUN_ID ?? "standalone");
mkdirSync(serverLogDir, { recursive: true });
const serverLogPath = resolve(serverLogDir, "server.log");

function log(level: "INFO" | "WARN" | "ERROR", message: string): void {
  const levels = { INFO: 0, WARN: 1, ERROR: 2 };
  const configuredLevel = config.logLevel.toUpperCase() as keyof typeof levels;
  if (levels[level] < (levels[configuredLevel] ?? levels.INFO)) return;
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const colors = { INFO: "\u001b[36m", WARN: "\u001b[33m", ERROR: "\u001b[31m" };
  const reset = "\u001b[0m";
  console.log(process.stdout.isTTY ? `${colors[level]}${line}${reset}` : line);
  appendFileSync(serverLogPath, `${line}\n`);
}

const requestStartedAt = new WeakMap<object, number>();
app.addHook("onRequest", async (request) => {
  requestStartedAt.set(request, Date.now());
});

app.addHook("onResponse", async (request, reply) => {
  const path = request.url.split("?", 1)[0];
  const elapsed = Math.max(0, Date.now() - (requestStartedAt.get(request) ?? Date.now()));
  log("INFO", `HTTP ${request.method} ${path} -> ${reply.statusCode} (${elapsed} ms)`);
});

app.addHook("onError", async (request, _reply, error) => {
  const path = request.url.split("?", 1)[0];
  log("ERROR", `HTTP ${request.method} ${path} failed: ${error.message}`);
});
const database = new GameDatabase(config.databasePath);
const clients = new Set<ConnectedClient>();
const rateLimiter = new FixedWindowRateLimiter();
let envelopeSequence = 0;
let screenWasConnected = false;
let screenMissingSince = 0;
let pausedForScreen = false;
const displaySettings: DisplaySettings = {
  qrMode: "public",
  masterVolume: 0.8,
  effectsVolume: 0.8,
  showVoteTrends: true,
  demoMode: false,
};

function send(client: ConnectedClient, type: string, payload: unknown, requestId?: string): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  if (requestId && (type === "request.ack" || type === "request.error")) {
    client.responses.set(requestId, { type, payload });
    if (client.responses.size > 200) {
      const oldest = client.responses.keys().next().value as string | undefined;
      if (oldest) client.responses.delete(oldest);
    }
  }
  client.socket.send(JSON.stringify({
    protocolVersion: 1,
    type,
    roomId: config.roomId,
    roundId: room.currentRoundId,
    sequence: ++envelopeSequence,
    serverTimestamp: Date.now(),
    ...(requestId ? { requestId } : {}),
    payload,
  }));
}

function broadcastState(state: PublicRoundState, reason: string): void {
  for (const client of clients) {
    send(client, "state.snapshot", {
      state,
      reason,
      ...(client.sessionId ? { session: room.sessionState(client.sessionId) } : {}),
      ...(client.observerOnly ? { session: { observerOnly: true } } : {}),
      ...(client.role !== "player" ? { settings: displaySettings } : {}),
      daily: database.getDaily(shanghaiDate()),
    });
  }
}

const room = new GameRoom(config.roomId, {
  onChange: broadcastState,
  onCheckpoint: (checkpoint) => database.saveCheckpoint(config.roomId, checkpoint),
  onRoundComplete: (round) => database.recordRound(round),
  onDailyIncrement: (increments) => {
    database.incrementDaily(shanghaiDate(), increments);
  },
  onSystemEvent: (eventType, details) => database.recordSystemEvent(eventType, details),
});

const checkpoint = database.loadCheckpoint<RoomCheckpoint>(config.roomId);
if (!checkpoint || !room.restore(checkpoint)) {
  if (config.autoStart) room.start();
}

app.get("/api/health", async () => {
  const screenClients = [...clients].filter((client) => client.role === "screen");
  return {
    status: "ok",
    roomId: config.roomId,
    phase: room.currentPhase,
    roundId: room.currentRoundId,
    mapId: room.currentMapId,
    players: room.connectedPlayers,
    websocketClients: clients.size,
    observers: [...clients].filter((client) => client.observerOnly).length,
    screenConnected: screenClients.length > 0,
    screenLastAckAt: Math.max(0, ...screenClients.map((client) => client.lastScreenAckAt ?? 0)),
    screenLastSequence: Math.max(-1, ...screenClients.map((client) => client.lastScreenSequence ?? -1)),
    pausedForScreen,
    publicOrigin: config.publicOrigin,
    localOrigin: config.localOrigin,
    uptimeSeconds: Math.floor(process.uptime()),
    serverTime: Date.now(),
  };
});

app.post("/api/session", async (request, reply) => {
  const ip = request.ip;
  if (!rateLimiter.allow("session:global", 600, 60_000) || !rateLimiter.allow(`session:${ip}`, 60, 60_000)) {
    return reply.code(429).send({ error: "请求过于频繁" });
  }
  const value = createSessionToken(config.sessionSecret);
  return { ...value, roomId: config.roomId, expiresInMs: 24 * 60 * 60_000 };
});

app.get("/api/bootstrap", async (request, reply) => {
  const query = request.query as { token?: string };
  const session = query.token ? verifySessionToken(config.sessionSecret, query.token) : undefined;
  if (!session) return reply.code(401).send({ error: "无效或过期的参与凭证" });
  return {
    roomId: config.roomId,
    publicOrigin: config.publicOrigin,
    state: room.snapshot(),
    session: room.sessionState(session.id),
    daily: database.getDaily(shanghaiDate()),
  };
});

app.get("/api/stats", async () => ({
  daily: database.getDaily(shanghaiDate()),
  recentRounds: database.recentRounds(20),
}));

app.get("/api/config", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!secureTokenMatches(config.adminToken, token)) return reply.code(401).send({ error: "未授权" });
  return { ...displaySettings, publicOrigin: config.publicOrigin, localOrigin: config.localOrigin };
});

app.get("/api/stats/export.csv", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!secureTokenMatches(config.adminToken, token)) return reply.code(401).send({ error: "未授权" });
  const header = ["round_id", "room_id", "map_id", "mode", "started_at", "ended_at", "connected_players", "first_run_success", "final_success", "choices_json", "score_json"];
  const escape = (value: unknown): string => `"${String(value).replaceAll('"', '""')}"`;
  const rows = database.exportRounds().map((round) => [
    round.roundId, round.roomId, round.mapId, round.mode, new Date(round.startedAt).toISOString(),
    new Date(round.endedAt).toISOString(), round.connectedPlayers, round.firstRunSuccess,
    round.finalSuccess, JSON.stringify(round.choices), JSON.stringify(round.score),
  ].map(escape).join(","));
  const csv = `\uFEFF${header.join(",")}\n${rows.join("\n")}\n`;
  return reply.type("text/csv; charset=utf-8").header("Content-Disposition", "attachment; filename=codegame-rounds.csv").send(csv);
});

app.get("/api/maps", async (request, reply) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!secureTokenMatches(config.adminToken, token)) return reply.code(401).send({ error: "未授权" });
  return GAME_MAPS.map((map) => ({
    id: map.id,
    name: map.name,
    chapter: map.chapter,
    difficulty: map.difficulty,
    modes: map.mode,
  }));
});

app.get("/api/qr.png", async (request, reply) => {
  const query = request.query as { mode?: DisplaySettings["qrMode"] };
  const mode = query.mode ?? displaySettings.qrMode;
  if (mode === "hidden") return reply.code(204).send();
  const origin = mode === "local" ? config.localOrigin : config.publicOrigin;
  const url = `${origin}/join?room=${encodeURIComponent(config.roomId)}`;
  const png = await QRCode.toBuffer(url, { width: 480, margin: 3, errorCorrectionLevel: "M" });
  return reply.type("image/png").header("Cache-Control", "no-store").send(png);
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit("connection", websocket, request);
  });
});

websocketServer.on("connection", (socket: WebSocket, request: HttpIncomingMessage) => {
  const parsedUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const requestedRole = parsedUrl.searchParams.get("role") ?? "player";
  if (requestedRole === "probe") {
    socket.send(JSON.stringify({
      protocolVersion: 1,
      type: "probe.ok",
      roomId: config.roomId,
      serverTimestamp: Date.now(),
      payload: { ok: true },
    }), () => socket.close(1000, "probe-complete"));
    return;
  }
  if (!["player", "screen", "admin"].includes(requestedRole)) {
    socket.close(4401, "Unknown role");
    return;
  }
  const role = requestedRole as ClientRole;
  const token = parsedUrl.searchParams.get("token") ?? undefined;
  let sessionId: string | undefined;

  if (role === "admin" && !secureTokenMatches(config.adminToken, token)) {
    socket.close(4401, "Unauthorized admin");
    return;
  }
  if (role === "screen" && !secureTokenMatches(config.screenToken, token)) {
    socket.close(4401, "Unauthorized screen");
    return;
  }
  if (role === "player") {
    const session = token ? verifySessionToken(config.sessionSecret, token) : undefined;
    if (!session) {
      socket.close(4401, "Invalid session");
      return;
    }
    sessionId = session.id;
  }

  const client: ConnectedClient = {
    socket,
    role,
    connectedAt: Date.now(),
    lastPongAt: Date.now(),
    responses: new Map(),
    ...(sessionId ? { sessionId } : {}),
  };
  clients.add(client);
  if (role === "screen") {
    screenWasConnected = true;
    screenMissingSince = 0;
    if (pausedForScreen) {
      pausedForScreen = false;
      room.resume();
    }
  }
  if (sessionId) {
    if (room.connectedPlayers >= config.maxPlayers) client.observerOnly = true;
    else room.connectPlayer(sessionId);
  }
  database.recordSystemEvent("websocket.connected", { role, ip: request.socket.remoteAddress });
  send(client, "session.welcome", {
    role,
    roomId: config.roomId,
    state: room.snapshot(),
    ...(sessionId ? { session: room.sessionState(sessionId) } : {}),
    ...(client.observerOnly ? { session: { observerOnly: true } } : {}),
    ...(role !== "player" ? { settings: displaySettings } : {}),
    daily: database.getDaily(shanghaiDate()),
  });

  socket.on("pong", () => {
    client.lastPongAt = Date.now();
  });

  socket.on("message", (raw: RawData) => {
    if (!rateLimiter.allow(`message:${role}:${sessionId ?? request.socket.remoteAddress ?? "unknown"}`, 60, 10_000)) {
      send(client, "request.error", { error: "消息过于频繁" });
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(client, "request.error", { error: "消息不是合法 JSON" });
      return;
    }
    if (message.requestId) {
      const cached = client.responses.get(message.requestId);
      if (cached) {
        send(client, cached.type, cached.payload, message.requestId);
        return;
      }
    }
    handleMessage(client, message);
  });

  socket.on("close", () => {
    clients.delete(client);
    if (client.sessionId && !client.observerOnly) room.disconnectPlayer(client.sessionId);
    if (client.role === "screen" && ![...clients].some((candidate) => candidate.role === "screen")) {
      screenMissingSince = Date.now();
    }
    database.recordSystemEvent("websocket.disconnected", { role });
  });

  socket.on("error", (error: Error) => {
    app.log.warn({ error, role }, "websocket client error");
  });
});

function handleMessage(client: ConnectedClient, message: ClientMessage): void {
  const requestId = message.requestId;
  if (message.type) log("INFO", `WS ${client.role} ${message.type}`);
  if (message.type === "ping") {
    send(client, "pong", { now: Date.now() }, requestId);
    return;
  }
  if (message.type === "screen.ack" && client.role === "screen") {
    client.lastScreenAckAt = Date.now();
    if (message.sequence !== undefined) client.lastScreenSequence = message.sequence;
    send(client, "request.ack", { ok: true }, requestId);
    return;
  }

  if (client.role === "player" && client.sessionId) {
    if (client.observerOnly) {
      send(client, "request.error", { error: "现场操作位已满，当前为只看模式" }, requestId);
      return;
    }
    let result: { ok: boolean; reason?: string } = { ok: false, reason: "未知玩家消息" };
    if (message.type === "vote.cast" && message.slotId && message.value !== undefined) {
      result = room.castVote(client.sessionId, message.slotId, message.value);
    } else if (message.type === "prediction.cast" && message.prediction) {
      result = room.castPrediction(client.sessionId, message.prediction);
    }
    send(client, result.ok ? "request.ack" : "request.error", result.ok ? { ok: true } : { error: result.reason }, requestId);
    return;
  }

  if (client.role === "admin" && message.type === "admin.command") {
    try {
      if (message.command === "start") room.start({ ...(message.mapId ? { mapId: message.mapId } : {}), ...(message.mode ? { mode: message.mode } : {}) });
      else if (message.command === "pause") room.pause();
      else if (message.command === "resume") room.resume();
      else if (message.command === "reset") room.reset({ ...(message.mapId ? { mapId: message.mapId } : {}), ...(message.mode ? { mode: message.mode } : {}) });
      else if (message.command === "skip") room.skipPhase();
      else if (message.command === "timings") {
        const timings: Partial<RoomTimings> = {};
        if (message.joinMs !== undefined) timings.joinMs = message.joinMs;
        if (message.briefingMs !== undefined) timings.briefingMs = message.briefingMs;
        if (message.voteMs !== undefined) timings.voteMs = message.voteMs;
        if (message.revealMs !== undefined) timings.revealMs = message.revealMs;
        if (message.compileMs !== undefined) timings.compileMs = message.compileMs;
        if (message.predictMs !== undefined) timings.predictMs = message.predictMs;
        if (message.resultMs !== undefined) timings.resultMs = message.resultMs;
        if (message.resetMs !== undefined) timings.resetMs = message.resetMs;
        room.updateTimings(timings);
      }
      else if (message.command === "display") {
        if (message.qrMode && ["public", "local", "hidden"].includes(message.qrMode)) displaySettings.qrMode = message.qrMode;
        if (message.masterVolume !== undefined) displaySettings.masterVolume = Math.min(1, Math.max(0, message.masterVolume));
        if (message.effectsVolume !== undefined) displaySettings.effectsVolume = Math.min(1, Math.max(0, message.effectsVolume));
        if (message.showVoteTrends !== undefined) displaySettings.showVoteTrends = message.showVoteTrends;
        if (message.demoMode !== undefined) displaySettings.demoMode = message.demoMode;
        database.recordSystemEvent("admin.display", displaySettings);
        broadcastState(room.snapshot(), "display-settings-updated");
      }
      else throw new Error("未知管理命令");
      send(client, "request.ack", { ok: true }, requestId);
    } catch (error) {
      send(client, "request.error", { error: error instanceof Error ? error.message : "管理命令失败" }, requestId);
    }
    return;
  }

  send(client, "request.error", { error: "当前身份无权执行该操作" }, requestId);
}

const serverDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const webDist = resolve(serverDirectory, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async () => ({
    name: "全场一起写代码",
    status: "server-ready",
    message: "Web 客户端尚未构建；开发时请运行 pnpm dev。",
  }));
}

const tickTimer = setInterval(() => {
  if (pausedForScreen) {
    if (room.currentPhase !== "PAUSED") room.pause();
    return;
  }
  room.tick();
  if (!screenWasConnected) return;
  const now = Date.now();
  const screenClients = [...clients].filter((client) => client.role === "screen");
  const hasHealthyScreen = screenClients.some((client) => now - (client.lastScreenAckAt ?? client.connectedAt) < 7_000);
  if (hasHealthyScreen) {
    screenMissingSince = 0;
    return;
  }
  if (screenMissingSince === 0) screenMissingSince = now;
  if (now - screenMissingSince >= 7_000 && room.currentPhase !== "PAUSED") {
    pausedForScreen = true;
    room.pause();
    database.recordSystemEvent("screen.watchdog.pause", { roomId: config.roomId, roundId: room.currentRoundId });
  }
}, 100);
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  rateLimiter.prune(now);
  for (const client of clients) {
    if (now - client.lastPongAt > 45_000) client.socket.terminate();
    else if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
  }
}, 15_000);

const shutdown = async (signal: string): Promise<void> => {
  log("INFO", `Shutting down after ${signal}.`);
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  database.saveCheckpoint(config.roomId, room.checkpoint());
  for (const client of clients) client.socket.close(1001, "Server shutdown");
  await app.close();
  database.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
log("INFO", `Game server listening on http://${config.host}:${config.port}.`);
log("INFO", `Public URL: ${config.publicOrigin}; room: ${config.roomId}.`);

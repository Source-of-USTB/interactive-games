import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import { getMapById, type ChoiceValue, type PublicRoundState } from "@codegame/game-core";
import { createSessionToken } from "../src/auth.js";

const playerCount = Number(process.env.LOAD_PLAYERS ?? 100);
const origin = process.env.LOAD_ORIGIN ?? "http://127.0.0.1:3000";
const websocketOrigin = origin.replace(/^http/, "ws");
const sessionSecret = process.env.SESSION_SECRET ?? "development-session-secret-change-me";
const adminToken = process.env.ADMIN_TOKEN ?? "development-admin-token";
const testMap = getMapById("boot-01-first-route");
if (!testMap) throw new Error("Load-test map is missing");

interface Envelope {
  type: string;
  requestId?: string;
  sequence?: number;
  payload?: { state?: PublicRoundState; error?: string };
}

class HarnessSocket {
  readonly websocket: WebSocket;
  state?: PublicRoundState;
  lastSequence = -1;
  sequenceRegressions = 0;
  private readonly requests = new Map<string, { resolve: () => void; reject: (error: Error) => void; startedAt: number }>();
  readonly latencies: number[] = [];

  constructor(url: string) {
    this.websocket = new WebSocket(url);
    this.websocket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Envelope;
      if (message.sequence !== undefined) {
        if (message.sequence <= this.lastSequence) this.sequenceRegressions += 1;
        this.lastSequence = message.sequence;
      }
      if ((message.type === "session.welcome" || message.type === "state.snapshot") && message.payload?.state) {
        this.state = message.payload.state;
      }
      if (message.requestId && (message.type === "request.ack" || message.type === "request.error")) {
        const pending = this.requests.get(message.requestId);
        if (!pending) return;
        this.requests.delete(message.requestId);
        this.latencies.push(performance.now() - pending.startedAt);
        if (message.type === "request.ack") pending.resolve();
        else pending.reject(new Error(message.payload?.error ?? "request rejected"));
      }
    });
  }

  async open(): Promise<void> {
    if (this.websocket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket open timeout")), 8_000);
      this.websocket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.websocket.once("error", reject);
    });
    await waitFor(() => Boolean(this.state), 8_000, "welcome snapshot");
  }

  request(message: Record<string, unknown>): Promise<void> {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject, startedAt: performance.now() });
      this.websocket.send(JSON.stringify({ protocolVersion: 1, requestId, ...message }));
      setTimeout(() => {
        const pending = this.requests.get(requestId);
        if (!pending) return;
        this.requests.delete(requestId);
        reject(new Error(`Request timeout: ${String(message.type)}`));
      }, 8_000);
    });
  }

  close(): void {
    this.websocket.close(1000, "load test finished");
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function main(): Promise<void> {
  const health = await fetch(`${origin}/api/health`);
  if (!health.ok) throw new Error(`Server is not healthy: HTTP ${health.status}`);

  const startedAt = performance.now();
  const players = Array.from({ length: playerCount }, () => {
    const { token } = createSessionToken(sessionSecret);
    return new HarnessSocket(`${websocketOrigin}/ws?role=player&token=${encodeURIComponent(token)}`);
  });
  const admin = new HarnessSocket(`${websocketOrigin}/ws?role=admin&token=${encodeURIComponent(adminToken)}`);

  try {
    await Promise.all([...players.map((player) => player.open()), admin.open()]);
    const connectedMs = performance.now() - startedAt;
    await admin.request({ type: "admin.command", command: "timings", joinMs: 3_000, voteMs: 3_000 });
    await admin.request({ type: "admin.command", command: "start", mode: "COCODE", mapId: testMap.id });
    await waitFor(() => players.every((player) => player.state?.phase === "JOIN"), 5_000, "all clients to see JOIN");
    await admin.request({ type: "admin.command", command: "skip" });
    await waitFor(() => players.every((player) => player.state?.phase === "AUTHORING"), 5_000, "all clients to see AUTHORING");

    for (const slot of testMap.template.flatMap((node) => node.kind === "choice" ? [node] : [])) {
      await waitFor(
        () => players.every((player) => player.state?.phase === "AUTHORING" && player.state.currentTally?.slotId === slot.slotId && !player.state.currentTally.locked),
        5_000,
        `open slot ${slot.slotId}`,
      );
      const standard = testMap.standardChoices[slot.slotId] as ChoiceValue;
      await Promise.all(players.map((player) => player.request({ type: "vote.cast", slotId: slot.slotId, value: standard })));
      await admin.request({ type: "admin.command", command: "skip" });
      await waitFor(
        () => players.every((player) => player.state?.currentTally?.locked === true && player.state.currentTally.submittedCount === playerCount),
        5_000,
        `locked tally ${slot.slotId}`,
      );
      const winner = players[0]?.state?.currentTally?.winner;
      if (winner !== standard) throw new Error(`Wrong winner for ${slot.slotId}: expected ${String(standard)}, got ${String(winner)}`);
      await admin.request({ type: "admin.command", command: "skip" });
    }

    await waitFor(() => players.every((player) => player.state?.phase === "COMPILE"), 5_000, "compile phase");
    const allLatencies = players.flatMap((player) => player.latencies);
    const regressions = players.reduce((sum, player) => sum + player.sequenceRegressions, 0);
    const finalHealth = await fetch(`${origin}/api/health`).then((response) => response.json()) as { players: number; websocketClients: number };
    if (finalHealth.players !== playerCount) throw new Error(`Expected ${playerCount} players, health reports ${finalHealth.players}`);
    if (regressions > 0) throw new Error(`Detected ${regressions} protocol sequence regressions`);
    if (percentile(allLatencies, 0.95) > 1_000) throw new Error(`P95 acknowledgement latency exceeded 1000 ms`);

    process.stdout.write(JSON.stringify({
      ok: true,
      players: playerCount,
      websocketClients: finalHealth.websocketClients,
      connectAllMs: Math.round(connectedMs),
      votesAcknowledged: allLatencies.length,
      ackLatencyMs: {
        p50: Math.round(percentile(allLatencies, 0.50)),
        p95: Math.round(percentile(allLatencies, 0.95)),
        max: Math.round(Math.max(...allLatencies)),
      },
      lockedSlots: Object.keys(testMap.standardChoices).length,
      sequenceRegressions: regressions,
    }, null, 2) + "\n");
  } finally {
    for (const player of players) player.close();
    admin.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

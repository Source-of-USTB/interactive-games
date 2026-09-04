import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyStats, PublicRoundState } from "@codegame/game-core";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SessionView {
  observerOnly?: boolean;
  selectedVote?: string | number;
}

export interface DisplaySettings {
  qrMode: "public" | "local" | "hidden";
  masterVolume: number;
  effectsVolume: number;
  showVoteTrends: boolean;
  demoMode: boolean;
  publicOrigin?: string;
  localOrigin?: string;
}

interface RealtimePayload {
  state: PublicRoundState;
  session?: SessionView;
  daily: DailyStats;
  reason?: string;
  settings?: DisplaySettings;
}

interface Envelope {
  type: string;
  requestId?: string;
  payload: unknown;
  roomId?: string;
  roundId?: string;
  sequence?: number;
  serverTimestamp?: number;
}

interface UseRealtimeOptions {
  role: "player" | "admin" | "screen";
  token?: string;
  enabled?: boolean;
}

function websocketUrl(role: string, token: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws?role=${encodeURIComponent(role)}&token=${encodeURIComponent(token)}`;
}

export function useRealtime({ role, token, enabled = true }: UseRealtimeOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [authInvalid, setAuthInvalid] = useState(false);
  const [state, setState] = useState<PublicRoundState>();
  const [daily, setDaily] = useState<DailyStats>();
  const [session, setSession] = useState<SessionView>({});
  const [notice, setNotice] = useState<string>();
  const [settings, setSettings] = useState<DisplaySettings>();
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const reconnectRef = useRef(0);
  const stoppedRef = useRef(false);
  const contextRef = useRef<{ roomId?: string; roundId?: string; sequence?: number }>({});
  const pendingRef = useRef(new Map<string, {
    finish: (ok: boolean, message?: string) => void;
    retryTimer: number;
  }>());

  useEffect(() => {
    if (!enabled || !token) {
      setStatus("closed");
      return;
    }
    stoppedRef.current = false;
    let reconnectTimer: number | undefined;

    const connect = (): void => {
      setStatus(reconnectRef.current > 0 ? "reconnecting" : "connecting");
      const socket = new WebSocket(websocketUrl(role, token));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        reconnectRef.current = 0;
        setAuthInvalid(false);
        setStatus("open");
        setNotice(undefined);
      });

      socket.addEventListener("message", (event) => {
        try {
          const envelope = JSON.parse(String(event.data)) as Envelope;
          contextRef.current = {
            ...(envelope.roomId ? { roomId: envelope.roomId } : {}),
            ...(envelope.roundId ? { roundId: envelope.roundId } : {}),
            ...(envelope.sequence !== undefined ? { sequence: envelope.sequence } : {}),
          };
          if (typeof envelope.serverTimestamp === "number") {
            setClockOffset(envelope.serverTimestamp - Date.now());
          }
          if (envelope.type === "session.welcome") {
            const payload = envelope.payload as RealtimePayload;
            setState(payload.state);
            setDaily(payload.daily);
            setSession(payload.session ?? {});
            setSettings(payload.settings);
          } else if (envelope.type === "state.snapshot") {
            const payload = envelope.payload as RealtimePayload;
            setState(payload.state);
            setDaily(payload.daily);
            setSession(payload.session ?? {});
            setSettings(payload.settings);
          } else if (envelope.type === "request.ack" || envelope.type === "request.error") {
            const requestId = envelope.requestId;
            const payload = envelope.payload as { error?: string };
            if (requestId) {
              pendingRef.current.get(requestId)?.finish(envelope.type === "request.ack", payload.error);
              pendingRef.current.delete(requestId);
            }
            if (envelope.type === "request.error") setNotice(payload.error ?? "操作未成功");
          }
        } catch {
          setNotice("收到无法识别的服务消息");
        }
      });

      socket.addEventListener("close", (event) => {
        if (socketRef.current === socket) socketRef.current = undefined;
        if (stoppedRef.current) {
          setStatus("closed");
          return;
        }
        if (event.code === 4401) {
          setAuthInvalid(true);
          setStatus("closed");
          setNotice(role === "player" ? "参与凭证已过期，请刷新页面" : "管理密钥无效");
          return;
        }
        reconnectRef.current += 1;
        setStatus("reconnecting");
        const delay = Math.min(10_000, 700 * 2 ** Math.min(4, reconnectRef.current));
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        setNotice("连接中断，正在自动恢复");
      });
    };

    connect();
    return () => {
      stoppedRef.current = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close(1000, "page unmounted");
    };
  }, [enabled, role, token]);

  const send = useCallback((message: Record<string, unknown>): Promise<void> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("连接尚未恢复"));
    const requestId = makeRequestId();
    return new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const envelope = { protocolVersion: 1, requestId, ...contextRef.current, ...message };
      const transmit = (): void => {
        const activeSocket = socketRef.current;
        if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
          pendingRef.current.delete(requestId);
          reject(new Error("连接尚未恢复"));
          return;
        }
        attempts += 1;
        activeSocket.send(JSON.stringify(envelope));
        const retryTimer = window.setTimeout(() => {
          if (attempts < 3) transmit();
          else {
            pendingRef.current.delete(requestId);
            reject(new Error("服务器确认超时"));
          }
        }, 1_700);
        const current = pendingRef.current.get(requestId);
        if (current) current.retryTimer = retryTimer;
      };
      pendingRef.current.set(requestId, {
        retryTimer: 0,
        finish: (ok, messageText) => {
          const pending = pendingRef.current.get(requestId);
          if (pending) window.clearTimeout(pending.retryTimer);
          pendingRef.current.delete(requestId);
          if (ok) resolve();
          else reject(new Error(messageText ?? "操作失败"));
        },
      });
      transmit();
    });
  }, []);

  return { status, state, daily, session, settings, clockOffset, notice, setNotice, authInvalid, send };
}

function makeRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;   // 标记版本 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;   // 标记变体
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tokenIssuedAt(token: string): number | undefined {
  try {
    const payload = token.split(".")[0];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(base64)) as { issuedAt?: number };
    return typeof parsed.issuedAt === "number" ? parsed.issuedAt : undefined;
  } catch {
    return undefined;
  }
}

export async function ensurePlayerToken(): Promise<string> {
  const key = "codegame.session.token";
  const existing = localStorage.getItem(key);
  if (existing) {
    const issuedAt = tokenIssuedAt(existing);
    if (issuedAt !== undefined && Date.now() - issuedAt < 20 * 60 * 60_000) return existing;
  }
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("无法创建参与会话");
  const data = await response.json() as { token: string };
  localStorage.setItem(key, data.token);
  return data.token;
}

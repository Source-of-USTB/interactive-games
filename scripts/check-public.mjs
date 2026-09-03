#!/usr/bin/env node

const publicOrigin = process.argv[2];
if (!publicOrigin) {
  console.error("Usage: node scripts/check-public.mjs <public-origin>");
  process.exit(2);
}

const origin = new URL(publicOrigin);
if (!['http:', 'https:'].includes(origin.protocol)) {
  console.error("Public origin must use HTTP or HTTPS.");
  process.exit(2);
}

async function fetchJson(path, init = {}) {
  const url = new URL(path, origin);
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(6_000) });
  } catch (error) {
    const detail = error instanceof Error && error.cause instanceof Error
      ? ` ${error.cause.message}`
      : error instanceof Error ? ` ${error.message}` : ` ${String(error)}`;
    throw new Error(`GET ${url.href} failed.${detail}`);
  }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${path} did not return JSON; a tunnel or proxy page may have intercepted it.`);
  }
  return response.json();
}

async function checkWebSocket() {
  const websocketUrl = new URL('/ws', origin);
  websocketUrl.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  websocketUrl.searchParams.set('role', 'probe');

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    let welcomed = false;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      socket.close();
      finish(() => reject(new Error('WebSocket player handshake did not complete within 8 seconds.')));
    }, 8_000);

    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'probe.ok') return;
        welcomed = true;
        socket.close(1000, 'public-check-complete');
      } catch (error) {
        socket.close();
        finish(() => reject(error));
      }
    });
    socket.addEventListener('error', () => {
      finish(() => reject(new Error('Public WebSocket connection failed.')));
    });
    socket.addEventListener('close', (event) => {
      if (welcomed && event.code === 1000) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(`WebSocket closed early: ${event.code} ${event.reason}`)));
    });
  });
}

try {
  const health = await fetchJson('/api/health');
  if (health.status !== 'ok') throw new Error('/api/health did not return status ok.');

  const session = await fetchJson('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: "{}",
  });
  if (typeof session.token !== 'string' || session.token.length === 0) {
    throw new Error('/api/session did not return a player token.');
  }

  const bootstrap = await fetchJson(`/api/bootstrap?token=${encodeURIComponent(session.token)}`);
  if (bootstrap.roomId !== health.roomId) throw new Error('Bootstrap room does not match the health check.');

  await checkWebSocket();
  console.log(`[INFO] Public check passed: ${origin.origin} (room ${health.roomId}; health, session, bootstrap, WebSocket).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

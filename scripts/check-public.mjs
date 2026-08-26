#!/usr/bin/env node

const publicOrigin = process.argv[2];
if (!publicOrigin) {
  console.error("用法：node scripts/check-public.mjs <public-origin>");
  process.exit(2);
}

const origin = new URL(publicOrigin);
if (!['http:', 'https:'].includes(origin.protocol)) {
  console.error("公网入口必须是 HTTP(S) 地址");
  process.exit(2);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(new URL(path, origin), {
    ...init,
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`${path} 返回 HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${path} 未返回 JSON，可能被隧道提示页截获`);
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
      finish(() => reject(new Error('WebSocket 在 8 秒内未完成玩家握手')));
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
      finish(() => reject(new Error('WebSocket 公网连接失败')));
    });
    socket.addEventListener('close', (event) => {
      if (welcomed && event.code === 1000) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(`WebSocket 提前关闭：${event.code} ${event.reason}`)));
    });
  });
}

try {
  const health = await fetchJson('/api/health');
  if (health.status !== 'ok') throw new Error('/api/health 状态不是 ok');

  const session = await fetchJson('/api/session', { method: 'POST' });
  if (typeof session.token !== 'string' || session.token.length === 0) {
    throw new Error('/api/session 未返回玩家凭证');
  }

  const bootstrap = await fetchJson(`/api/bootstrap?token=${encodeURIComponent(session.token)}`);
  if (bootstrap.roomId !== health.roomId) throw new Error('Bootstrap 房间与健康检查不一致');

  await checkWebSocket();
  console.log(JSON.stringify({
    ok: true,
    origin: origin.origin,
    roomId: health.roomId,
    checks: ['health', 'session', 'bootstrap', 'websocket'],
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

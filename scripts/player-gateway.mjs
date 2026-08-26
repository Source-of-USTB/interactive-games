#!/usr/bin/env node

import http from 'node:http';

const listenHost = process.env.PUBLIC_GATEWAY_HOST ?? '127.0.0.1';
const listenPort = Number(process.env.PUBLIC_GATEWAY_PORT ?? 3100);
const backendHost = '127.0.0.1';
const backendPort = Number(process.env.PORT ?? 3000);

function pathOf(rawUrl = '/') {
  return new URL(rawUrl, 'http://player-gateway.local').pathname;
}

function isAllowedHttp(method, pathname) {
  if ((method === 'GET' || method === 'HEAD') && pathname === '/join') return true;
  if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/assets/') && !pathname.endsWith('.map')) return true;
  if (method === 'GET' && pathname === '/api/health') return true;
  if (method === 'POST' && pathname === '/api/session') return true;
  if (method === 'GET' && pathname === '/api/bootstrap') return true;
  return false;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function backendHeaders(request) {
  const headers = { ...request.headers };
  headers.host = `${backendHost}:${backendPort}`;
  delete headers['proxy-connection'];
  return headers;
}

function proxyHttp(request, response) {
  const upstream = http.request({
    hostname: backendHost,
    port: backendPort,
    method: request.method,
    path: request.url,
    headers: backendHeaders(request),
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', (error) => {
    if (!response.headersSent) sendJson(response, 502, { error: '游戏服务尚未就绪' });
    else response.destroy(error);
  });
  request.pipe(upstream);
}

function proxySanitizedHealth(response) {
  const upstream = http.get({
    hostname: backendHost,
    port: backendPort,
    path: '/api/health',
    headers: { host: `${backendHost}:${backendPort}` },
  }, (upstreamResponse) => {
    let body = '';
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      if (body.length < 64 * 1024) body += chunk;
    });
    upstreamResponse.on('end', () => {
      try {
        const health = JSON.parse(body);
        sendJson(response, upstreamResponse.statusCode ?? 200, {
          status: health.status,
          roomId: health.roomId,
          phase: health.phase,
          roundId: health.roundId,
          mapId: health.mapId,
          players: health.players,
          websocketClients: health.websocketClients,
          publicOrigin: health.publicOrigin,
          serverTime: health.serverTime,
        });
      } catch {
        sendJson(response, 502, { error: '游戏服务健康检查响应无效' });
      }
    });
  });
  upstream.on('error', () => sendJson(response, 502, { error: '游戏服务尚未就绪' }));
}

const server = http.createServer((request, response) => {
  const pathname = pathOf(request.url);
  const method = request.method ?? 'GET';
  if (!isAllowedHttp(method, pathname)) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  if (method === 'GET' && pathname === '/api/health') {
    proxySanitizedHealth(response);
    return;
  }
  proxyHttp(request, response);
});

server.on('upgrade', (request, clientSocket, head) => {
  const url = new URL(request.url ?? '/', 'http://player-gateway.local');
  const isPlayerSocket = url.pathname === '/ws'
    && url.searchParams.get('role') === 'player'
    && Boolean(url.searchParams.get('token'));
  const isProbeSocket = url.pathname === '/ws' && url.searchParams.get('role') === 'probe';
  if (!isPlayerSocket && !isProbeSocket) {
    clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const upstreamRequest = http.request({
    hostname: backendHost,
    port: backendPort,
    method: 'GET',
    path: request.url,
    headers: backendHeaders(request),
  });

  upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}\r\n`;
    const headerLines = [];
    for (let index = 0; index < upstreamResponse.rawHeaders.length; index += 2) {
      headerLines.push(`${upstreamResponse.rawHeaders[index]}: ${upstreamResponse.rawHeaders[index + 1]}\r\n`);
    }
    clientSocket.write(`${statusLine}${headerLines.join('')}\r\n`);
    if (head.length > 0) upstreamSocket.write(head);
    if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamRequest.on('response', (upstreamResponse) => {
    clientSocket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 502} ${upstreamResponse.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\n\r\n`);
    upstreamResponse.pipe(clientSocket);
  });
  upstreamRequest.on('error', () => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
  });
  upstreamRequest.end();
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(listenPort, listenHost, () => {
  console.log(JSON.stringify({
    status: 'ready',
    gateway: `http://${listenHost}:${listenPort}`,
    backend: `http://${backendHost}:${backendPort}`,
    publicRoutes: ['/join', '/assets/*', '/api/health', '/api/session', '/api/bootstrap', '/ws?role=player|probe'],
  }));
});

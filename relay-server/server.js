// relay-server/server.js — 원격 데스크톱 WebSocket 릴레이
const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const SECRET = process.env.RELAY_SECRET || 'oksooht-remote-2026';

const agents = new Map();
const viewers = new Map();
const startedAt = new Date().toISOString();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      service: 'oksooht-remote-relay',
      agents: agents.size,
      viewers: [...viewers.values()].reduce((n, s) => n + s.size, 0),
      startedAt
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({ server });

function auth(msg) {
  return msg && msg.secret === SECRET && msg.pcId;
}

wss.on('connection', (ws) => {
  let role = null;
  let pcId = null;

  ws.on('message', (data, isBinary) => {
    if (!role) {
      try {
        const msg = JSON.parse(data.toString());
        if (!auth(msg)) { ws.close(4001, 'auth failed'); return; }
        role = msg.role;
        pcId = msg.pcId;

        if (role === 'agent') {
          agents.set(pcId, ws);
          console.log('[Relay] agent connected:', pcId);
        } else if (role === 'viewer') {
          if (!viewers.has(pcId)) viewers.set(pcId, new Set());
          viewers.get(pcId).add(ws);
          console.log('[Relay] viewer connected:', pcId);
          const agent = agents.get(pcId);
          if (agent && agent.readyState === WebSocket.OPEN) {
            agent.send(JSON.stringify({ type: 'start_stream' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'PC 오프라인 또는 릴레이 미연결' }));
          }
        }
      } catch (_) {
        ws.close(4002, 'bad hello');
      }
      return;
    }

    if (role === 'agent' && isBinary) {
      const set = viewers.get(pcId);
      if (!set) return;
      set.forEach(v => { if (v.readyState === WebSocket.OPEN) v.send(data, { binary: true }); });
      return;
    }

    if (role === 'viewer' && !isBinary) {
      const agent = agents.get(pcId);
      if (agent && agent.readyState === WebSocket.OPEN) agent.send(data);
    }
  });

  ws.on('close', () => {
    if (role === 'agent' && pcId) {
      agents.delete(pcId);
      const set = viewers.get(pcId);
      if (set) {
        set.forEach(v => { try { v.send(JSON.stringify({ type: 'agent_offline' })); } catch (_) {} });
      }
      console.log('[Relay] agent disconnected:', pcId);
    }
    if (role === 'viewer' && pcId) {
      const set = viewers.get(pcId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          viewers.delete(pcId);
          const agent = agents.get(pcId);
          if (agent && agent.readyState === WebSocket.OPEN) {
            agent.send(JSON.stringify({ type: 'stop_stream' }));
          }
        }
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Relay] listening on ${HOST}:${PORT}`);
});

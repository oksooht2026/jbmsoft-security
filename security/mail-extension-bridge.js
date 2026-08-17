// security/mail-extension-bridge.js — Chrome Native Messaging → Electron 내부 HTTP 브리지
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 38471;
const BRIDGE_TOKEN_FILE = 'mail-bridge.token';

let server = null;
let bridgeToken = '';
let portFilePath = null;
let onMailLog = null;

function getTokenPath(userDataPath) {
  return path.join(userDataPath, BRIDGE_TOKEN_FILE);
}

function loadOrCreateToken(userDataPath) {
  const tokenPath = getTokenPath(userDataPath);
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenPath, token, 'utf8');
  return token;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function start(options = {}) {
  const { userDataPath, port = DEFAULT_PORT, onLog } = options;
  onMailLog = onLog || null;
  bridgeToken = loadOrCreateToken(userDataPath);
  portFilePath = path.join(userDataPath, 'mail-bridge.port');

  if (server) return Promise.resolve({ port, token: bridgeToken });

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, service: 'oksoo-mail-bridge' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/mail-log') {
        const auth = req.headers['x-bridge-token'] || '';
        if (auth !== bridgeToken) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        try {
          const body = await readJsonBody(req);
          if (typeof onMailLog === 'function') {
            onMailLog(body);
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = addr.port;
      fs.writeFileSync(portFilePath, String(actualPort), 'utf8');
      console.log(`[MailBridge] localhost:${actualPort} 대기 중`);
      resolve({ port: actualPort, token: bridgeToken });
    });
  });
}

function stop() {
  return new Promise(resolve => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

function getBridgeInfo(userDataPath) {
  const token = loadOrCreateToken(userDataPath);
  let port = DEFAULT_PORT;
  const portPath = path.join(userDataPath, 'mail-bridge.port');
  if (fs.existsSync(portPath)) {
    port = parseInt(fs.readFileSync(portPath, 'utf8'), 10) || DEFAULT_PORT;
  }
  return { port, token };
}

module.exports = {
  start,
  stop,
  getBridgeInfo,
  DEFAULT_PORT
};

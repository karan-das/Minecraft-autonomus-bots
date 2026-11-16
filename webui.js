// ========================================
// WEB CONTROL DASHBOARD SERVER (zero-dependency Node HTTP)
// Dashboard UI: dashboard.html  |  API: /api/state /api/logs /api/config
//                /api/connect /api/spawn /api/disconnect /api/stop /api/chat
// ========================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const util = require('util');

const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');

let consolePatched = false;
const logLines = [];

function captureConsole() {
  if (consolePatched) return;
  consolePatched = true;
  const push = (level, args) => {
    try {
      const line = `[${new Date().toLocaleTimeString()}][${level}] ` +
        args.map(a => (typeof a === 'string' ? a : util.inspect(a, { depth: 1 }))).join(' ');
      logLines.push(line.slice(0, 500));
      if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
    } catch {}
  };
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.log = (...a) => { push('INFO', a); origLog(...a); };
  console.warn = (...a) => { push('WARN', a); origWarn(...a); };
  console.error = (...a) => { push('ERR', a); origError(...a); };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 50000) { data = ''; req.destroy(); resolve({}); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function buildAgentRow(a) {
  const bot = a.bot;
  const entity = bot?.entity;
  return {
    username: a.username,
    slot: a.agentSlot,
    isLeader: Boolean(a.isLeader),
    status: a.status,
    connected: Boolean(a.connected),
    disconnectReason: a.disconnectReason || null,
    health: Math.round(bot?.health ?? 0),
    food: Math.round(bot?.food ?? 0),
    position: entity ? {
      x: Math.round(entity.position.x),
      y: Math.round(entity.position.y),
      z: Math.round(entity.position.z)
    } : null,
    heldItem: bot?.heldItem?.name || null,
    gameMode: bot?.game?.gameMode || null,
    chunks: bot?.world?.columns
      ? (typeof bot.world.columns.size === 'number' ? bot.world.columns.size : Object.keys(bot.world.columns).length)
      : 0
  };
}

function serveDashboard(res) {
  fs.readFile(DASHBOARD_FILE, (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`dashboard.html not found: ${err.message}`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
}

function startWebUI(ctx) {
  captureConsole();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${ctx.port}`);
    const path = url.pathname;

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
      }

      if (req.method === 'GET' && path === '/') {
        return serveDashboard(res);
      }

      if (req.method === 'GET' && path === '/api/state') {
        const agents = ctx.agents().map(buildAgentRow);
        return sendJSON(res, 200, {
          ok: true,
          config: ctx.getBotConfig(),
          agents,
          memory: ctx.getMemoryInfo(),
          evo: ctx.getEvoInfo(),
          heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
          rssMB: Math.round(process.memoryUsage().rss / 1048576),
          uptimeSec: Math.round(process.uptime())
        });
      }

      if (req.method === 'GET' && path === '/api/logs') {
        return sendJSON(res, 200, { ok: true, lines: logLines.slice(-250) });
      }

      if (req.method === 'POST' && path === '/api/config') {
        const body = await readBody(req);
        const cfg = ctx.setBotConfig(body);
        console.log(`[WEB] Config updated: host=${cfg.SERVER_HOST}:${cfg.SERVER_PORT} bot=${cfg.BOT_USERNAME} owner=${cfg.OWNER_USERNAME || '(none)'}`);
        return sendJSON(res, 200, { ok: true, config: cfg, message: 'Config saved' });
      }

      if (req.method === 'POST' && path === '/api/connect') {
        const r = ctx.ensureLeader();
        return sendJSON(res, 200, { ok: true, message: r.already ? 'Leader already connecting/online' : `Leader spawning: ${r.username}` });
      }

      if (req.method === 'POST' && path === '/api/spawn') {
        const body = await readBody(req);

        // Named mode: हर bot का custom नाम, पहला नाम leader बनता है (अगर leader offline हो)
        if (Array.isArray(body.names) && body.names.length) {
          const r = ctx.startSwarmNamed(body.names);
          if (!r.ok) return sendJSON(res, 200, { ok: false, error: r.error });
          console.log(`[WEB] Named swarm: leader=${r.leader} queued=[${r.queued.join(', ')}]`);
          return sendJSON(res, 200, {
            ok: true,
            leader: r.leader,
            queued: r.queued,
            message: `Leader: ${r.leader} | ${r.queued.length} bots queued: ${r.queued.join(', ') || '(कोई नहीं — सब पहले से active)'}`
          });
        }

        // Count mode: auto-generated names (BotName_02, BotName_03...)
        const count = Math.max(1, Math.min(20, Number.parseInt(body.count, 10) || 3));
        const r = ctx.startSwarm(count);
        return sendJSON(res, 200, { ok: true, message: `Swarm started (target ${r.count} bots)` });
      }

      if (req.method === 'POST' && path === '/api/disconnect') {
        const body = await readBody(req);
        const r = ctx.disconnectBot(String(body.username || ''));
        return sendJSON(res, 200, { ok: r.ok, error: r.error, message: r.ok ? `${body.username} disconnected` : undefined });
      }

      if (req.method === 'POST' && path === '/api/stop') {
        const body = await readBody(req);
        if (body.all) {
          ctx.stopAll(true);
          return sendJSON(res, 200, { ok: true, message: 'ALL bots disconnected (leader included)' });
        }
        ctx.stopSwarmOnly();
        return sendJSON(res, 200, { ok: true, message: 'Swarm stopped (leader online rahega)' });
      }

      if (req.method === 'POST' && path === '/api/chat') {
        const body = await readBody(req);
        const r = ctx.sendChat(String(body.target || 'leader'), String(body.message || ''));
        return sendJSON(res, 200, { ok: r.ok, error: r.error, message: r.ok ? `${r.username}: sent` : undefined });
      }

      return sendJSON(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message });
    }
  });

  server.on('error', err => {
    console.warn(`[WEB] Server error: ${err.message}`);
  });

  server.listen(ctx.port, () => {
    console.log(`[WEB] Dashboard live -> http://localhost:${ctx.port}  (LAN: http://<your-ip>:${ctx.port})`);
  });

  return server;
}

module.exports = { startWebUI, buildAgentRow };

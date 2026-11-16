// ========================================
// HERO SERVER MANAGER (Express)
// Serve dashboard.html + POST se naye bot.js processes spawn karo.
// Har MC server = apna alag instance (process + memory + evolution data).
// ========================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const crypto = require('crypto');

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');
const REGISTRY_FILE = path.join(__dirname, 'instances.json');
const INSTANCE_ROOT = path.join(__dirname, 'instances');
const MAX_INSTANCES = 12;
const LOG_MAX = 500;

const instances = new Map(); // id -> { id, name, host, port, botUsername, ownerUsername, friendlyPlayers, autoStart, child, status, logs, lastState, startedAt, createdAt, stderrBuf }
const pendingCmds = new Map(); // cmdId -> { resolve, timer, instId }
let cmdSeq = 0;

// ---------- registry persistence ----------
function loadRegistry() {
  try {
    const list = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (Array.isArray(list)) {
      for (const meta of list) {
        instances.set(meta.id, { ...meta, child: null, status: 'stopped', logs: [], lastState: null, startedAt: null, stderrBuf: '' });
      }
    }
  } catch {}
}

function saveRegistry() {
  try {
    const list = [...instances.values()].map(i => ({
      id: i.id, name: i.name, host: i.host, port: i.port, botUsername: i.botUsername,
      ownerUsername: i.ownerUsername, friendlyPlayers: i.friendlyPlayers, autoStart: i.autoStart,
      createdAt: i.createdAt
    }));
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2));
  } catch (err) { console.warn('[REGISTRY] save failed:', err.message); }
}

// ---------- child process ----------
function pushLog(inst, line) {
  inst.logs.push(line);
  if (inst.logs.length > LOG_MAX) inst.logs.splice(0, inst.logs.length - LOG_MAX);
}

function spawnInstance(inst) {
  if (inst.child) return;
  const dir = path.join(INSTANCE_ROOT, inst.id);
  fs.mkdirSync(dir, { recursive: true });
  inst.logs = [];
  inst.stderrBuf = '';
  inst.lastState = null;
  inst.status = 'starting';
  inst.startedAt = Date.now();

  const child = fork(path.join(__dirname, 'bot.js'), ['--managed'], {
    silent: true,
    env: {
      ...process.env,
      HERO_INSTANCE_DIR: dir,
      HERO_SERVER_HOST: inst.host,
      HERO_SERVER_PORT: String(inst.port),
      HERO_BOT_USERNAME: inst.botUsername,
      HERO_OWNER_USERNAME: inst.ownerUsername || '',
      HERO_FRIENDLY_PLAYERS: (inst.friendlyPlayers || []).join(','),
      HERO_AUTO_LEADER: inst.autoStart ? '1' : '0'
    }
  });
  inst.child = child;
  pushLog(inst, `[PARENT] Process spawned (pid=${child.pid}) -> ${inst.host}:${inst.port}`);

  let stdoutBuf = '';
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      pushLog(inst, stdoutBuf.slice(0, idx).slice(0, 400));
      stdoutBuf = stdoutBuf.slice(idx + 1);
    }
  });
  child.stderr.on('data', (d) => {
    inst.stderrBuf += d.toString();
    let idx;
    while ((idx = inst.stderrBuf.indexOf('\n')) !== -1) {
      pushLog(inst, `[stderr] ${inst.stderrBuf.slice(0, idx).slice(0, 380)}`);
      inst.stderrBuf = inst.stderrBuf.slice(idx + 1);
    }
  });

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state' && msg.state) {
      inst.lastState = msg.state;
      inst.status = 'running';
    } else if (msg.replyId && pendingCmds.has(msg.replyId)) {
      const p = pendingCmds.get(msg.replyId);
      if (p.instId !== inst.id) return;
      pendingCmds.delete(msg.replyId);
      clearTimeout(p.timer);
      p.resolve(msg);
    }
  });

  child.on('exit', (code, signal) => {
    inst.child = null;
    inst.status = 'stopped';
    pushLog(inst, `[PARENT] Process exited (code=${code} signal=${signal})`);
    for (const [cid, p] of [...pendingCmds.entries()]) {
      if (p.instId === inst.id) {
        pendingCmds.delete(cid);
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'instance stopped' });
      }
    }
    if (inst.pendingRestart) {
      inst.pendingRestart = false;
      pushLog(inst, '[PARENT] Restart requested — respawn in 1.5s…');
      setTimeout(() => { if (!inst.child) spawnInstance(inst); }, 1500);
    }
    saveRegistry();
  });
}

function sendCommand(inst, type, payload = {}, timeoutMs = 10000) {
  if (!inst.child) return Promise.resolve({ ok: false, error: 'instance not running' });
  const id = String(++cmdSeq);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCmds.delete(id);
      resolve({ ok: false, error: `command timeout: ${type}` });
    }, timeoutMs);
    pendingCmds.set(id, { resolve, timer, instId: inst.id });
    try { inst.child.send({ id, type, payload }); } catch (err) {
      pendingCmds.delete(id); clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    }
  });
}

// ---------- helpers ----------
function publicMeta(inst) {
  return {
    id: inst.id, name: inst.name, host: inst.host, port: inst.port,
    botUsername: inst.botUsername, ownerUsername: inst.ownerUsername,
    friendlyPlayers: inst.friendlyPlayers, autoStart: Boolean(inst.autoStart),
    status: inst.status, running: Boolean(inst.child),
    pid: inst.child?.pid || null, startedAt: inst.startedAt, createdAt: inst.createdAt,
    agents: inst.lastState?.agents?.length || 0
  };
}

function pickInstance(req) {
  const id = req.get('x-instance-id') || req.query.instance || '';
  if (id && instances.has(id)) return instances.get(id);
  for (const inst of instances.values()) if (inst.child) return inst;
  return null;
}

function findRunningInstanceOr404(req, res) {
  const inst = pickInstance(req);
  if (!inst) { res.status(404).json({ ok: false, error: 'No instance selected/running. Pehle instance create karo.' }); return null; }
  return inst;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-instance-id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (req, res) => {
  fs.readFile(DASHBOARD_FILE, (err, html) => {
    if (err) return res.status(500).send(`dashboard.html not found: ${err.message}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  });
});

// ----- instance management -----
app.get('/api/instances', (req, res) => {
  res.json({ ok: true, instances: [...instances.values()].map(publicMeta) });
});

app.post('/api/instances', (req, res) => {
  const b = req.body || {};
  const host = String(b.host || '').trim();
  const port = Number.parseInt(b.port, 10) || 25565;
  const name = String(b.name || '').trim().slice(0, 40) || `MC-${host}-${port}`;
  const botUsername = String(b.botUsername || 'Herobrain').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Herobrain';
  const ownerUsername = String(b.ownerUsername || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  const friendlyPlayers = Array.isArray(b.friendlyPlayers) ? b.friendlyPlayers.map(v => String(v).replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean) : [];
  const autoStart = b.autoStart === undefined ? true : Boolean(b.autoStart);

  if (!host) return res.status(400).json({ ok: false, error: 'host required' });
  if (port < 1 || port > 65535) return res.status(400).json({ ok: false, error: 'invalid port' });
  if (instances.size >= MAX_INSTANCES) return res.status(400).json({ ok: false, error: `Max ${MAX_INSTANCES} instances` });
  const dup = [...instances.values()].find(i => i.host === host && i.port === port && i.botUsername === botUsername);
  if (dup) return res.status(400).json({ ok: false, error: `Duplicate: "${dup.name}" already targets ${host}:${port} with ${botUsername}` });

  const inst = {
    id: crypto.randomBytes(5).toString('hex'),
    name, host, port, botUsername, ownerUsername, friendlyPlayers, autoStart,
    child: null, status: 'stopped', logs: [], lastState: null, startedAt: null,
    createdAt: new Date().toISOString(), stderrBuf: ''
  };
  instances.set(inst.id, inst);
  saveRegistry();
  spawnInstance(inst);
  res.json({ ok: true, instance: publicMeta(inst) });
});

app.post('/api/instances/:id/restart', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ ok: false, error: 'instance not found' });
  inst.pendingRestart = true;
  if (inst.child) { try { inst.child.kill('SIGTERM'); } catch {} }
  else { inst.pendingRestart = false; spawnInstance(inst); }
  res.json({ ok: true, instance: publicMeta(inst) });
});

app.post('/api/instances/:id/stop', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ ok: false, error: 'instance not found' });
  if (inst.child) { try { inst.child.kill('SIGTERM'); } catch {} }
  else { inst.status = 'stopped'; saveRegistry(); }
  res.json({ ok: true, instance: publicMeta(inst) });
});

app.delete('/api/instances/:id', (req, res) => {
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ ok: false, error: 'instance not found' });
  if (inst.child) { try { inst.child.kill('SIGTERM'); } catch {} }
  instances.delete(inst.id);
  saveRegistry();
  res.json({ ok: true });
});

// ----- per-instance control (same API shapes as webui.js — dashboard unchanged logic) -----
app.get('/api/state', async (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  const fresh = await sendCommand(inst, 'state', {}, 8000);
  const state = fresh.ok ? fresh.result : inst.lastState;
  if (!state) return res.json({ ok: false, error: 'Instance starting — state abhi nahi aaya', meta: publicMeta(inst) });
  res.json({ ...state, meta: publicMeta(inst) });
});

app.get('/api/logs', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  res.json({ ok: true, lines: inst.logs.slice(-250), meta: publicMeta(inst) });
});

app.post('/api/config', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  sendCommand(inst, 'setConfig', req.body || {}).then(r => res.json(r.ok ? { ok: true, config: r.result } : r));
});

app.post('/api/connect', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  sendCommand(inst, 'ensureLeader').then(r => res.json(r.ok ? r.result : r));
});

app.post('/api/spawn', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  const b = req.body || {};
  const cmd = Array.isArray(b.names) && b.names.length ? 'startSwarmNamed' : 'startSwarm';
  const payload = Array.isArray(b.names) && b.names.length ? { names: b.names } : { count: Number.parseInt(b.count, 10) || 2 };
  sendCommand(inst, cmd, payload).then(r => res.json(r.ok ? r.result : r));
});

app.post('/api/disconnect', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  sendCommand(inst, 'disconnectBot', req.body || {}).then(r => res.json(r.ok ? r.result : r));
});

app.post('/api/stop', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  const b = req.body || {};
  if (b.all === true) sendCommand(inst, 'stopAll', { all: true }).then(r => res.json(r.ok ? r.result : r));
  else sendCommand(inst, 'stopSwarm').then(r => res.json(r.ok ? r.result : r));
});

app.post('/api/chat', (req, res) => {
  const inst = findRunningInstanceOr404(req, res);
  if (!inst) return;
  const b = req.body || {};
  sendCommand(inst, 'chat', { target: b.target, message: b.message }).then(r => res.json(r.ok ? r.result : r));
});

loadRegistry();

app.listen(PORT, () => {
  console.log(`[SERVER] Hero Server Manager live -> http://localhost:${PORT}  (instances: ${instances.size})`);
  console.log('[SERVER] Bots dashboard se spawn honge — POST /api/instances {name, host, port, botUsername, ownerUsername, friendlyPlayers, autoStart}');
});

const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

const {
  pathfinder,
  goals: { GoalFollow, GoalNear, GoalXZ }
} = require('mineflayer-pathfinder');

// mineflayer-pvp removed: our smartCombatTick already handles PvP + crits, and the plugin leaked physicTick listeners.
// const { plugin: pvpPlugin } = require('mineflayer-pvp');
// mineflayer-collectblock (mineflayer-tool) removed: its equipForBlock recursion caused 4GB OOM crashes.
// const { plugin: collectBlockPlugin } = require('mineflayer-collectblock');
const minecraftData = require('minecraft-data');

const { EvolutionSystem, MODES } = require('./evolution');
const { createSkillController } = require('./skills');

function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadDotEnv();

// ========================================
// CONFIGURATION
// ========================================

// Runtime-editable config (managed from Web Dashboard -> bot-config.json)
const CONFIG_FILE = path.join(__dirname, 'bot-config.json');

const DEFAULT_BOT_CONFIG = {
  SERVER_HOST: 'luderick.aternos.host',
  SERVER_PORT: 60419,
  BOT_USERNAME: 'Herobrain',
  OWNER_USERNAME: 'kzix',
  FRIENDLY_PLAYERS: []
};

function loadBotConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      SERVER_HOST: String(raw.SERVER_HOST || DEFAULT_BOT_CONFIG.SERVER_HOST).trim(),
      SERVER_PORT: Number.parseInt(raw.SERVER_PORT, 10) || DEFAULT_BOT_CONFIG.SERVER_PORT,
      BOT_USERNAME: String(raw.BOT_USERNAME || DEFAULT_BOT_CONFIG.BOT_USERNAME).trim(),
      OWNER_USERNAME: String(raw.OWNER_USERNAME === undefined ? DEFAULT_BOT_CONFIG.OWNER_USERNAME : raw.OWNER_USERNAME).trim(),
      FRIENDLY_PLAYERS: Array.isArray(raw.FRIENDLY_PLAYERS)
        ? raw.FRIENDLY_PLAYERS.map(v => String(v).trim()).filter(Boolean)
        : [...DEFAULT_BOT_CONFIG.FRIENDLY_PLAYERS]
    };
  } catch {
    return {
      SERVER_HOST: DEFAULT_BOT_CONFIG.SERVER_HOST,
      SERVER_PORT: DEFAULT_BOT_CONFIG.SERVER_PORT,
      BOT_USERNAME: DEFAULT_BOT_CONFIG.BOT_USERNAME,
      OWNER_USERNAME: DEFAULT_BOT_CONFIG.OWNER_USERNAME,
      FRIENDLY_PLAYERS: [...DEFAULT_BOT_CONFIG.FRIENDLY_PLAYERS]
    };
  }
}

let botRuntimeConfig = loadBotConfig();

function saveBotConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(botRuntimeConfig, null, 2));
    console.log(`[CONFIG] Saved -> ${CONFIG_FILE}`);
  } catch (err) {
    console.log('[CONFIG ERROR]', err.message);
  }
}

const CONFIG = {
  get botPrefix() { return botRuntimeConfig.BOT_USERNAME; },
  get ownerUsername() { return botRuntimeConfig.OWNER_USERNAME; },
  get friendlyPlayers() { return botRuntimeConfig.FRIENDLY_PLAYERS; },
  bedrockUsernamePrefix: process.env.FLOODGATE_USERNAME_PREFIX || '.',
  pvp: {
    enabled: true,
    retaliationEnabled: true,
    attackRange: 32,
    revengeDuration: 60000,
    targetCooldown: 1500,
    aggressive: true
  },
  dodge: {
    enabled: true,
    distance: 4,
    cooldown: 1200,
    duration: 420,
    jump: true
  }
};

const AUTO_BRAIN = true;
const BRAIN_INTERVAL = 850;
const MEMORY_FILE = path.join(__dirname, 'bot-memory.json');

// Optional CLI flag: node bot.js --swarm 8
const swarmFlagIdx = process.argv.indexOf('--swarm');
const INITIAL_SWARM_COUNT = swarmFlagIdx !== -1
  ? Math.max(1, Math.min(20, parseInt(process.argv[swarmFlagIdx + 1] || '4', 10) || 4))
  : 1;

// UI-ONLY mode: sirf dashboard/API start hota hai, koi bot auto-connect NAHI hota.
// Trigger: `npm start` (bot.js --ui-only) ya env UI_ONLY=1. Bots dashboard buttons se spawn hote hain.
const UI_ONLY_MODE = process.argv.includes('--ui-only') || process.env.UI_ONLY === '1';

const SWARM_CONNECT_DELAY_MS = Math.max(
  5000,
  Number.parseInt(process.env.SWARM_CONNECT_DELAY_MS || '8000', 10) || 8000
);
const SWARM_SPAWN_TIMEOUT_MS = 45000;

let arenaControlEnabled = false;
let arenaTimer = null;

// Groq AI Chatbot
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
const GROQ_MODELS = [
  'openai/gpt-oss-20b',
];

console.log(
  GROQ_API_KEY
    ? `[GROQ] Ready! Key detected (${GROQ_API_KEY.slice(0, 6)}...). Trigger: Hey bot / heybot / !ask`
    : '[GROQ] DISABLED: Set GROQ_API_KEY in terminal or .env file.'
);

const chatCooldown = new Map();
const chatHistory = new Map();
const BOT_TRIGGER = /^(?:!?\s*hey\s*(?:bot|ptaji|pitaji|herobrain)|!ask)\b/i;

function normalizeChatPlayerName(value) {
  let name = String(value || '').trim();
  const configuredPrefix = String(process.env.FLOODGATE_USERNAME_PREFIX || '.');
  for (const prefix of [...new Set([configuredPrefix, '.', '*'].filter(Boolean))]) {
    if (name.startsWith(prefix)) { name = name.slice(prefix.length); break; }
  }
  return name.toLowerCase();
}

function isAuthorizedCommandUser(username) {
  return !botRuntimeConfig.OWNER_USERNAME || normalizeChatPlayerName(username) === normalizeChatPlayerName(botRuntimeConfig.OWNER_USERNAME);
}

// ========================================
// PERSISTENT WORLD MEMORY & SHARED EVOLUTION ENGINE
// ========================================

function loadMemory() {
  try {
    const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return {
      completedTasks: data.completedTasks || {},
      failedTasks: data.failedTasks || {},
      resources: data.resources || {},
      dangerousLocations: data.dangerousLocations || [],
      itemBlockKnowledge: data.itemBlockKnowledge || { blocks: {}, items: {}, observations: 0 },
      portalPosition: data.portalPosition || null,
      decisions: data.decisions || 0,
      stage: data.stage || 1,
      basePosition: data.basePosition || null,
      lastPosition: data.lastPosition || null
    };
  } catch {
    return {
      completedTasks: {},
      failedTasks: {},
      resources: {},
      dangerousLocations: [],
      itemBlockKnowledge: { blocks: {}, items: {}, observations: 0 },
      portalPosition: null,
      decisions: 0,
      stage: 1,
      basePosition: null,
      lastPosition: null
    };
  }
}

const memory = loadMemory();

function saveMemory() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.log('[MEMORY ERROR]', err.message);
  }
}

const evo = new EvolutionSystem({
  rootDir: __dirname,
  populationSize: 32,
  eliteCount: 5
});

// Active swarm registry & shared team memory bus
const activeAgents = [];
let leaderReconnectAttempts = 0;
let shuttingDown = false;
let swarmEvolveTimer = null;
let swarmQueue = [];
let swarmQueueRunning = false;
let swarmQueueEpoch = 0;
let lastSwarmEvolutionExperienceCount = 0;
let lastEvolutionAt = 0;
const MIN_LIVE_EVIDENCE_PER_GENERATION = 12;

const swarmSharedContext = {
  claims: new Map(),
  discoveries: [],
  requests: [],
  stations: {
    crafting_table: null,
    furnace: null,
    chest: null,
    smithing_table: null,
    nether_portal: memory.portalPosition || null
  },
  roles: new Map(),
  knowledge: memory.itemBlockKnowledge
};

function getOnlineAgents() {
  return activeAgents.filter(agent => agent.status === 'online' && agent.bot?.entity);
}

function getOnlineAgentCount() {
  return getOnlineAgents().length;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// CREATE SINGLE OR SWARM BOT AGENT
// ========================================

function createBotAgent(agentSlot, username, isLeader = false) {
  console.log(`[BOT] Connecting ${username} (slot=${agentSlot})...`);

  let agentHandle = null;
  let connectionStatus = 'connecting';
  let disconnectReason = '';
  let firstSpawnResolved = false;
  let resolveFirstSpawn;
  const spawnPromise = new Promise(resolve => { resolveFirstSpawn = resolve; });

  function setConnectionStatus(status) {
    connectionStatus = status;
    if (agentHandle) {
      agentHandle.status = status;
      agentHandle.connected = status === 'online';
    }
  }

  function settleFirstSpawn(value) {
    if (firstSpawnResolved) return;
    firstSpawnResolved = true;
    resolveFirstSpawn(Boolean(value));
  }

  const bot = mineflayer.createBot({
    host: botRuntimeConfig.SERVER_HOST,
    port: botRuntimeConfig.SERVER_PORT,
    username,
    version: '26.1',
    viewDistance: 'tiny',
    auth: 'offline'
  });

  const originalWrite = bot._client.write.bind(bot._client);
  bot._client.write = (name, packet) => {
    const result = originalWrite(name, packet);
    if (['position', 'position_look', 'look', 'flying'].includes(name)) {
      try { originalWrite('tick_end', {}); } catch {}
    }
    return result;
  };

  bot.loadPlugin(pathfinder);
  // bot.loadPlugin(pvpPlugin); // removed: smartCombatTick covers PvP + criticals

  const state = {
    health: 20,
    food: 20,
    stage: memory.stage || 1,
    nearbyThreats: [],
    currentGoal: 'initializing'
  };

  const skills = createSkillController({
    bot,
    state,
    memory,
    saveMemory,
    evo,
    config: { ...CONFIG, swarmContext: swarmSharedContext },
    agentSlot
  });

  let mcData = null;
  let greeted = false;
  let brainTimer = null;
  let watchdogTimer = null;
  let mining = false;
  let brainEnabled = AUTO_BRAIN;

  let activeTask = null;
  let taskRunning = false;
  let taskInterrupted = false;
  let taskInterruptReason = '';
  let brainBusy = false;
  let brainBusySince = 0;
  let taskStartedAt = 0;
  let lastGearCheck = 0;
  const taskQueue = [];

  let lastServerDeathHint = null;
  let lastServerDeathHintAt = 0;

  function log(msg) {
    console.log(`[BRAIN:${username}]`, msg);
  }

  function enqueueTask(name, priority, execute) {
    taskQueue.push({ name, priority, execute });
    taskQueue.sort((a, b) => b.priority - a.priority);
  }

  async function interruptCurrentTask(reason) {
    if (!taskRunning) {
      skills.clearMovement();
      return;
    }
    if (taskInterrupted) return;
    log(`Interrupting ${activeTask}: ${reason}`);
    taskInterrupted = true;
    taskInterruptReason = String(reason || 'interrupted');
    try { await bot.collectBlock.cancelTask(); } catch {}
    try { bot.stopDigging(); } catch {}
    skills.clearMovement();
  }

  async function executeTask(task) {
    if (taskRunning || !brainEnabled) return;
    taskRunning = true;
    taskStartedAt = Date.now();
    taskInterrupted = false;
    activeTask = task.name;
    state.currentGoal = task.name;

    try {
      const result = await task.execute();
      if (!taskInterrupted && result === true) {
        memory.completedTasks[task.name] = (memory.completedTasks[task.name] || 0) + 1;
      } else if (!taskInterrupted) {
        memory.failedTasks[task.name] = (memory.failedTasks[task.name] || 0) + 1;
      }
    } catch (err) {
      if (!taskInterrupted) {
        memory.failedTasks[task.name] = (memory.failedTasks[task.name] || 0) + 1;
        log(`Task failed: ${task.name} - ${err.message}`);
      }
    } finally {
      activeTask = null;
      taskRunning = false;
      taskStartedAt = 0;
      taskInterrupted = false;
      taskInterruptReason = '';
      state.currentGoal = 'thinking';
      skills.useNavigationMovements();
    }
  }

  function launchTask(task) {
    if (!task || taskRunning || !brainEnabled) return false;
    executeTask(task).catch(err => log(`Task launcher error: ${err.message}`));
    return true;
  }

  skills.bindTaskHooks({
    isInterrupted: () => taskInterrupted,
    isRunning: () => taskRunning,
    interrupt: interruptCurrentTask
  });

  function observeWorld() {
    if (!bot.entity) return;
    state.health = bot.health;
    state.food = bot.food;
    state.nearbyThreats = [];

    for (const e of Object.values(bot.entities)) {
      if (
        (skills.isHostileEntity(e) || skills.isCreeperEntity(e)) &&
        e.position.distanceTo(bot.entity.position) < 16
      ) {
        state.nearbyThreats.push({
          name: e.name,
          distance: e.position.distanceTo(bot.entity.position),
          id: e.id
        });
      }
    }
    state.nearbyThreats.sort((a, b) => a.distance - b.distance);

    if (isLeader) {
      memory.lastPosition = {
        x: Math.floor(bot.entity.position.x),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z)
      };
    }
  }

  async function brainTick() {
    if (!brainEnabled || !bot.entity || !mcData) return;

    // Anti-freeze guard: never allow a hung promise to freeze brain or task forever!
    if (brainBusy) {
      if (brainBusySince && Date.now() - brainBusySince > 12000) {
        log('Brain hung >12s — force resetting brainBusy & recovering.');
        brainBusy = false;
        brainBusySince = 0;
        skills.clearMovement();
      } else {
        return;
      }
    }
    if (taskRunning && taskStartedAt && Date.now() - taskStartedAt > 45000) {
      log(`Task '${activeTask}' hung >45s — force aborting & unstucking.`);
      taskRunning = false;
      taskInterrupted = false;
      activeTask = null;
      taskStartedAt = 0;
      skills.clearMovement();
      skills.recoverFromStuck().catch(() => {});
    }

    brainBusy = true;
    brainBusySince = Date.now();
    try {
      observeWorld();
      memory.decisions++;

      if (Date.now() - lastGearCheck > 10000) {
        lastGearCheck = Date.now();
        await skills.upgradeArmor();
        await skills.equipShield();
      }

      const survivalDecision = skills.selectDynamicSurvivalGoal();

      // Critical Survival Gate
      if (bot.health <= 9 || bot.food <= 6) {
        const guarded = Boolean(skills.getGuardUsername());
        if (!guarded) {
          skills.stopCombat();
          skills.clearRevenge();
        }
        const threat = skills.nearestHostile(guarded ? 6 : 9);
        const safeIndoorTask = activeTask === 'eat_food' || activeTask?.startsWith('craft_');
        if (taskRunning && (!safeIndoorTask || threat)) {
          await interruptCurrentTask(bot.health <= 9 ? 'Critical health' : 'Critical hunger');
        }

        const ate = activeTask === 'eat_food' ? false : await skills.eatFood(true);
        if (guarded) {
          // While following/defending: keep protecting — only retreat if threat is very close AND nearly dead
          if (threat && bot.health <= 6) {
            const dx = bot.entity.position.x - threat.position.x;
            const dz = bot.entity.position.z - threat.position.z;
            const len = Math.hypot(dx, dz) || 1;
            skills.useNavigationMovements();
            skills.setGoal(new GoalXZ(
              Math.floor(bot.entity.position.x + (dx / len) * 12),
              Math.floor(bot.entity.position.z + (dz / len) * 12)
            ));
          }
          return;
        }
        if (threat) {
          const dx = bot.entity.position.x - threat.position.x;
          const dz = bot.entity.position.z - threat.position.z;
          const len = Math.hypot(dx, dz) || 1;
          skills.useNavigationMovements();
          skills.setGoal(new GoalXZ(
            Math.floor(bot.entity.position.x + (dx / len) * 12),
            Math.floor(bot.entity.position.z + (dz / len) * 12)
          ));
          return;
        }

        // Only run safe eating/crafting while critical; never start outdoor mining/exploring at low HP
        if (!ate && !taskRunning && survivalDecision && (survivalDecision.name === 'eat_food' || survivalDecision.name.startsWith('craft_'))) {
          launchTask(survivalDecision);
        }
        return;
      }

      if (survivalDecision?.name === 'eat_food' && (bot.food <= 15 || bot.health <= 12)) {
        if (taskRunning && activeTask !== 'eat_food') await interruptCurrentTask('Food/health priority');
        if (!taskRunning) launchTask(survivalDecision);
        return;
      }

      if (
        !skills.getGuardUsername() &&
        bot.food <= 14 &&
        survivalDecision?.name === 'hunt_food' &&
        (bot.food <= 8 || skills.hasFoodAnimalNearby(32)) &&
        !activeTask?.startsWith('craft_')
      ) {
        if (taskRunning && activeTask !== 'hunt_food') await interruptCurrentTask('Food gathering priority');
        if (!taskRunning) launchTask(survivalDecision);
        return;
      }

      if (skills.playerRevengeTick()) return;
      if (await skills.avoidCreepers()) return;
      if (!skills.getGuardUsername() && await skills.cooperationTick()) return;
      if (await skills.protectFriendlyPlayer()) return;

      if (bot.health > 13 && bot.food > 10 && await skills.defensiveCombat()) return;
      if (skills.getGuardUsername()) return;

      if (taskRunning) return;
      const coopTask = skills.selectCoopActionTask();
      if (coopTask) {
        launchTask(coopTask);
        return;
      }
      if (taskQueue.length) {
        launchTask(taskQueue.shift());
        return;
      }

      if (survivalDecision) launchTask(survivalDecision);
    } finally {
      brainBusy = false;
      brainBusySince = 0;
    }
  }

  function startBrain() {
    if (brainTimer) clearInterval(brainTimer);
    brainTimer = setInterval(() => {
      brainTick().catch(err => console.error(`[BRAIN ERROR:${username}]`, err));
    }, BRAIN_INTERVAL);
  }

  function parseServerDeathMessage(msg) {
    if (!msg || !msg.includes(username)) return;
    const lower = msg.toLowerCase();
    const slainMatch = msg.match(new RegExp(`${username}\\s+(?:was slain by|was shot by|was killed by|was blown up by|was pummeled by|was fireballed by)\\s+([^\\s]+)`, 'i'));
    if (slainMatch) {
      lastServerDeathHint = { attackerName: slainMatch[1], cause: 'slain' };
      lastServerDeathHintAt = Date.now();
      return;
    }
    if (lower.includes('fell') || lower.includes('hit the ground')) lastServerDeathHint = { attackerName: null, cause: 'fall' };
    else if (lower.includes('lava') || lower.includes('burn') || lower.includes('fire')) lastServerDeathHint = { attackerName: null, cause: 'lava' };
    else if (lower.includes('drowned')) lastServerDeathHint = { attackerName: null, cause: 'drown' };
    else if (lower.includes('starved')) lastServerDeathHint = { attackerName: null, cause: 'starve' };
    lastServerDeathHintAt = Date.now();
  }

  // Real-time 50ms physics loop: Auto-jump, Parkour, MLG, and True Crit Combat
  bot.on('physicsTick', () => {
    skills.autoJumpTick();
    skills.swimTick();
    skills.smartCombatTick();
    skills.observeParkourTick();
    skills.checkAndPerformMLG().catch(() => {});
  });

  bot.on('entitySwingArm', (entity) => skills.onEntitySwingArm(entity));
  bot.on('entityHurt', (entity) => skills.onEntityHurt(entity));
  bot.on('entityDead', (entity) => {
    if (entity) skills.onEntityDead(entity);
  });

  bot.on('spawn', () => {
    setConnectionStatus('online');
    settleFirstSpawn(true);
    mcData = minecraftData(bot.version);
    skills.applyPhysicsWorkaround();
    if (isLeader) leaderReconnectAttempts = 0;
    skills.markRespawned();
    skills.setMcData(mcData);

    if (!skills.getBasePosition()) {
      if (memory.basePosition) {
        skills.setBasePosition(new Vec3(memory.basePosition.x, memory.basePosition.y, memory.basePosition.z));
      } else {
        skills.setBasePosition(bot.entity.position.clone());
      }
    }

    if (isLeader && !greeted) {
      console.log('[BOT] Leader spawned successfully!');
      bot.chat(`Hello! Tumhara Pitaji aagaya! (Gen ${evo.generation} | ${evo.mode})`);
      console.log(evo.formatDashboard(null, getOnlineAgentCount()));
      console.log('Commands: !follow !come !stop !resume !attack !defend !defendoff !mine !wood !base !return !brain !stage !unstuck');
      console.log('Progress & Coop: !goal | !team | !knowledge [block|item] | !resetmemory');
      console.log('Evolution: !evo status | !evo mode live/training/evaluation | !evo eval');
      console.log('Swarm & Arena: !swarm start <count> | !swarm stop | !arena on/off | !arena mlg/pvp/night');
      greeted = true;
    }

    const guard = skills.getGuardUsername();
    if (guard) {
      const player = skills.findPlayerEntity(guard);
      if (player) skills.setGoal(new GoalFollow(player, 3), true);
    }

    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = setInterval(() => skills.movementWatchdogTick(), 500);

    if (AUTO_BRAIN && !brainTimer) startBrain();
  });

  bot.on('death', () => {
    const ctx = skills.getDeathContext();
    if (lastServerDeathHint && Date.now() - lastServerDeathHintAt < 4000) {
      ctx.attackerName = lastServerDeathHint.attackerName || ctx.attackerName;
      ctx.cause = lastServerDeathHint.cause || ctx.cause;
    }

    const isSwarm = getOnlineAgentCount() > 1;
    const learned = evo.learnFromDeath({ ...ctx, skipImmediateEvolve: isSwarm }, agentSlot);

    skills.stopCombat();
    skills.clearRevenge();
    swarmSharedContext.focusTargetId = null;
    swarmSharedContext.requests = swarmSharedContext.requests.filter(r => r.requester !== username);
    mining = false;
    taskQueue.length = 0;
    interruptCurrentTask('Death').catch(() => {});
    skills.clearMovement();

    if (!isSwarm || isLeader) {
      if (learned.summary) console.log(evo.formatDashboard(learned.summary, getOnlineAgentCount()));
      bot.chat(`Death learned: ${learned.evidence}.`);
    }
  });

  bot.on('stoppedAttacking', () => {
    const guard = skills.getGuardUsername();
    if (!guard || !bot.entity || skills.getRevengeTargetName()) return;
    const player = skills.findPlayerEntity(guard);
    if (player) skills.setGoal(new GoalFollow(player, 3), true);
  });

  // ========================================
  // LEADER CHAT, GROQ AI & COMMANDS
  // ========================================

  async function executeNaturalIntent(username, text) {
    const lower = text.toLowerCase();
    if (/\bfollow\s+me\b|\bmere\s+peeche\b/.test(lower)) {
      const player = skills.findPlayerEntity(username);
      if (!player) return 'player_not_visible';
      const pos = player.position.clone();
      for (const a of getOnlineAgents()) await a.orderFollowOrDefend(username, 'follow', pos);
      return 'executed_follow';
    }
    if (/\bdefend\s+me\b|\bprotect\s+me\b|\bmere\s+ko\s+bacha/.test(lower)) {
      const player = skills.findPlayerEntity(username);
      if (!player) return 'player_not_visible';
      const pos = player.position.clone();
      for (const a of getOnlineAgents()) await a.orderFollowOrDefend(username, 'defend', pos);
      return 'executed_defend';
    }
    if (/\bcome\s+(?:here|to\s+me)\b|\bidhar\s+aa/.test(lower)) {
      const player = skills.findPlayerEntity(username);
      if (!player) return 'player_not_visible';
      const pos = player.position.clone();
      for (const a of getOnlineAgents()) await a.orderCome(pos);
      return 'executed_come';
    }
    if (/\bstop\b|\bruk\s+ja\b/.test(lower)) {
      brainEnabled = false;
      for (const a of getOnlineAgents()) {
        a.setBrainEnabled(false);
        a.orderClearGuard();
      }
      skills.stopCombat();
      await interruptCurrentTask('Natural stop');
      return 'executed_stop';
    }
    return null;
  }

  async function groqReply(username, message) {
    if (!GROQ_API_KEY) {
      bot.chat(`${username}: Groq API key missing! Set GROQ_API_KEY in terminal or .env`);
      return;
    }

    const now = Date.now();
    const last = chatCooldown.get(username) || 0;
    if (now - last < 3000) return;
    chatCooldown.set(username, now);

    const question = message
      .replace(BOT_TRIGGER, '')
      .replace(/^[,:\s]+/, '')
      .trim()
      .slice(0, 400);

    if (!question) {
      bot.chat(`${username}: Haan bol, kya kaam hai?`);
      return;
    }

    const actionResult = isAuthorizedCommandUser(username)
      ? await executeNaturalIntent(username, question)
      : null;

    const champ = evo.bestOverall;
    const pos = bot.entity?.position;
    const invText = skills.getInventorySummaryText();
    const visiblePlayer = skills.findPlayerEntity(username);
    const nearbyNames = state.nearbyThreats.map(t => `${t.name}(${Math.round(t.distance)}m)`).join(', ') || 'none';

    const systemPrompt = `
You are Ptaji (Herobrain), an evolving Minecraft survival AI bot.

REAL LIVE FACTS (NEVER lie or invent items not listed here!):
- Mode: ${evo.mode}, Swarm Bots Active: ${getOnlineAgentCount()}, Generation: ${evo.generation}, Learning Velocity: ${evo.learningVelocity?.toFixed(2)}x
- Team Role: ${skills.getSwarmRole()} | ${skills.getProgressChecklistText()}
- Block/Item Knowledge: ${skills.getKnowledgeSummaryText()}
- Best Overall Score: ${((champ?.overallScore || 0) * 100).toFixed(1)}%
- HP: ${Math.round(bot.health || 20)}/20, Food: ${bot.food || 20}/20
- Position: ${pos ? `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})` : 'unknown'}
- Actual Inventory: ${invText}
- Current Goal: ${state.currentGoal}, Stage: ${state.stage}/7
- Nearby Threats: ${nearbyNames}
- Can see ${username}: ${visiblePlayer ? `YES (${Math.round(visiblePlayer.position.distanceTo(pos))}m away)` : 'NO (too far away)'}
- Action just executed: ${actionResult || 'none'}
- Deaths Learned: ${evo.environmentModel.deathCount}, Last lesson: ${evo.environmentModel.lastLesson?.evidence || 'none'}

Rules:
- Reply naturally in English or Hinglish under 160 characters.
- ONLY report items that actually appear in "Actual Inventory" above.
- Never reveal API keys.
`.trim();

    const history = chatHistory.get(username) || [];
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6),
      { role: 'user', content: question }
    ];

    let lastError = 'Unknown error';
    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.6 })
        });

        const data = await res.json();
        if (!res.ok) {
          lastError = `${model}: ${data?.error?.message || `HTTP ${res.status}`}`;
          continue;
        }

        const answer = (data.choices?.[0]?.message?.content || '')
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .slice(0, 180);

        if (answer) {
          chatHistory.set(username, [
            ...history.slice(-6),
            { role: 'user', content: question },
            { role: 'assistant', content: answer }
          ]);
          bot.chat(`${username}: ${answer}`);
          return;
        }
      } catch (error) {
        lastError = error.message;
      }
    }
    bot.chat(`${username}: Groq error (${lastError.slice(0, 80)})`);
  }

  if (isLeader) {
    bot.on('chat', async (username, message) => {
      if (normalizeChatPlayerName(username).startsWith(normalizeChatPlayerName(botRuntimeConfig.BOT_USERNAME))) return;

      if (BOT_TRIGGER.test(message)) {
        groqReply(username, message);
        return;
      }

      if (!isAuthorizedCommandUser(username)) return;

      const args = message.trim().toLowerCase().split(/\s+/);
      const bareCommands = new Set(['follow', 'defend', 'defendoff', 'come', 'stop', 'resume', 'status', 'players', 'base', 'return', 'wood', 'unstuck', 'goal', 'team', 'coop', 'knowledge']);
      const command = args[0].startsWith('!') ? args[0] : (bareCommands.has(args[0]) ? `!${args[0]}` : args[0]);

      if (command === '!swarm') {
        const sub = args[1] || 'status';
        if (sub === 'start') {
          const count = Math.min(20, Math.max(2, parseInt(args[2] || '6', 10) || 6));
          evo.setMode(MODES.TRAINING);
          startSwarm(count);
          bot.chat(`Spawning ${count} learning bots in TRAINING mode!`);
        } else if (sub === 'stop') {
          stopSwarm();
          evo.setMode(MODES.LIVE);
          bot.chat('Swarm bots disconnected. Leader in LIVE mode.');
        } else {
          bot.chat(`Swarm Active: ${getOnlineAgentCount()} online | Mode: ${evo.mode} | Gen: ${evo.generation}`);
        }
      }

      else if (command === '!team' || command === '!coop') {
        bot.chat(`Swarm(${getOnlineAgentCount()}): ${skills.getTeamStatusText().slice(0, 180)}`);
      }

      else if (command === '!rally' || command === '!unite') {
        const player = skills.findPlayerEntity(username);
        if (player) {
          swarmSharedContext.teamAnchor = {
            x: Math.floor(player.position.x),
            y: Math.floor(player.position.y),
            z: Math.floor(player.position.z),
            updatedAt: Date.now()
          };
        }
        skills.triggerSquadRally();
        bot.chat('Squad Rally! All bots regrouping together.');
      }

      else if (command === '!goal') {
        bot.chat(skills.getProgressChecklistText());
      }

      else if (command === '!knowledge') {
        const query = args[1] || null;
        bot.chat(skills.getKnowledgeSummaryText(query).slice(0, 200));
      }

      else if (command === '!resetmemory') {
        memory.completedTasks = {};
        memory.failedTasks = {};
        memory.dangerousLocations = [];
        saveMemory();
        bot.chat('Task counters & dangerous-location cache cleared (neural brain & block knowledge preserved).');
      }

      else if (command === '!arena') {
        const sub = args[1] || 'status';
        if (sub === 'on') {
          arenaControlEnabled = true;
          startArenaTrainer(bot);
          bot.chat('Arena control ON.');
        } else if (sub === 'off') {
          arenaControlEnabled = false;
          if (arenaTimer) { clearInterval(arenaTimer); arenaTimer = null; }
          bot.chat('Arena control OFF.');
        } else if (sub === 'mlg') {
          bot.chat(`/give ${username} water_bucket 1`);
          for (const a of activeAgents) {
            if (a.bot.entity) {
              bot.chat(`/give ${a.bot.username} water_bucket 1`);
              bot.chat(`/tp ${a.bot.username} ~ ~25 ~`);
            }
          }
        } else if (sub === 'pvp') {
          for (const a of activeAgents) {
            if (a.bot.entity) {
              bot.chat(`/give ${a.bot.username} iron_sword 1`);
              bot.chat(`/summon zombie ~3 ~ ~3`);
            }
          }
        } else if (sub === 'night') {
          bot.chat('/time set night');
        } else {
          bot.chat(`Arena Control: ${arenaControlEnabled ? 'ON' : 'OFF'}`);
        }
      }

      else if (command === '!evo') {
        const sub = args[1] || 'status';
        if (sub === 'mode') {
          const target = args[2] === 'train' ? 'TRAINING' : args[2] === 'eval' ? 'EVALUATION' : args[2];
          if (evo.setMode(target)) {
            bot.chat(`Evolution mode switched to: ${evo.mode}`);
            console.log(evo.formatDashboard(null, getOnlineAgentCount()));
          } else {
            bot.chat('Use: !evo mode live | training | evaluation');
          }
        } else if (sub === 'train') {
          const newEvidence = Math.max(0, evo.getLiveExperienceCount() - lastSwarmEvolutionExperienceCount);
          bot.chat(`Evidence-gated E-HRL active. Live outcomes since last gen: ${newEvidence}/${MIN_LIVE_EVIDENCE_PER_GENERATION}.`);
        } else if (sub === 'eval') {
          evo.setMode(MODES.EVALUATION);
          const summary = evo.evaluateGeneration();
          console.log(evo.formatDashboard(summary, getOnlineAgentCount()));
          bot.chat(`Eval Gen ${summary.generation}: ${(summary.bestOverallScore * 100).toFixed(1)}% across 9 skills.`);
        } else if (sub === 'save') {
          evo.saveAll();
          saveMemory();
          bot.chat('Evolutionary progress & block knowledge saved.');
        } else {
          console.log(evo.formatDashboard(null, getOnlineAgentCount()));
          const champ = evo.bestOverall;
          bot.chat(
            `E-HRL ${evo.mode} | Gen ${evo.generation} | Vel: ${evo.learningVelocity?.toFixed(2)}x | Outcomes: ${evo.getLiveExperienceCount()} | Best: ${((champ?.overallScore || 0) * 100).toFixed(1)}%`
          );
        }
      }

      else if (command === '!mlg') {
        const ok = await skills.checkAndPerformMLG();
        bot.chat(ok ? 'MLG clutch executed!' : 'No fall/clutch item detected right now.');
      }

      else if (command === '!bridge') {
        await interruptCurrentTask('Manual bridge');
        const ok = await skills.safeSneakBridge(4);
        bot.chat(ok ? 'Bridge built!' : 'Need building blocks to bridge.');
      }

      else if (command === '!trap') {
        await interruptCurrentTask('Manual trap');
        const ok = await skills.placeStrategicTrap(true);
        bot.chat(ok ? 'Trap placed!' : 'Could not place trap here.');
      }

      else if (command === '!shelter') {
        await interruptCurrentTask('Manual shelter');
        const ok = await skills.buildQuickShelter();
        bot.chat(ok ? 'Quick shelter built!' : 'Need at least 16 building blocks.');
      }

      else if (command === '!follow') {
        const player = skills.findPlayerEntity(username);
        if (!player) return bot.chat(`Cannot resolve ${username}. Use !players.`);
        const pos = player.position.clone();
        const limit = parseInt(args[1], 10);
        const targets = Number.isInteger(limit) && limit > 0
          ? getOnlineAgents().slice(0, limit)
          : getOnlineAgents();
        for (const a of targets) await a.orderFollowOrDefend(username, 'follow', pos);
        bot.chat(`${targets.length} bot(s) following ${username}!`);
      }

      else if (command === '!come') {
        const player = skills.findPlayerEntity(username);
        if (!player) return bot.chat(`Cannot resolve ${username}. Use !players.`);
        const pos = player.position.clone();
        const online = getOnlineAgents();
        for (const a of online) await a.orderCome(pos);
        bot.chat(`${online.length} bot(s) coming to you!`);
      }

      else if (command === '!stop') {
        for (const a of activeAgents) a.setBrainEnabled(false);
        bot.chat('All bot activities stopped.');
      }

      else if (command === '!resume') {
        for (const a of activeAgents) a.setBrainEnabled(true);
        bot.chat('Autonomous brains resumed.');
      }

      else if (command === '!brain') {
        if (args[1] === 'on') {
          brainEnabled = true;
          if (!brainTimer) startBrain();
          bot.chat('Autonomous AI enabled.');
        } else if (args[1] === 'off') {
          brainEnabled = false;
          skills.stopCombat();
          await interruptCurrentTask('Brain disabled');
          bot.chat('Autonomous AI disabled.');
        } else {
          bot.chat(`Brain: ${brainEnabled ? 'ON' : 'OFF'} | Mode: ${evo.mode} | Gen: ${evo.generation} | Stage: ${state.stage}/7 | Goal: ${state.currentGoal}`);
        }
      }

      else if (command === '!stage' || command === '!status') {
        skills.computeProgressionStage();
        bot.chat(`Gen ${evo.generation} (${evo.mode}) | Stage ${state.stage}/7 | Goal: ${state.currentGoal} | HP: ${Math.round(bot.health)} | Food: ${bot.food}`);
      }

      else if (command === '!unstuck') {
        const recovered = await skills.recoverFromStuck();
        bot.chat(recovered ? 'Unstuck recovery completed.' : 'Could not escape current spot.');
      }

      else if (command === '!players') {
        const names = skills.getVisiblePlayerNames();
        bot.chat(names.length ? `Visible: ${names.join(', ').slice(0, 170)}` : 'No visible players.');
      }

      else if (command === '!attack') {
        const req = args[1];
        skills.setGuardUsername(null);
        await interruptCurrentTask('Manual attack');
        const target = bot.nearestEntity(e =>
          (skills.isHostileEntity(e) || skills.isCreeperEntity(e)) &&
          (!req || e.name === req) &&
          e.position.distanceTo(bot.entity.position) <= 20
        );
        if (!target) return bot.chat('No target found.');
        await skills.engageMobTarget(target, 'pvp');
        bot.chat(`Attacking ${target.name} (Crit PvP enabled)`);
      }

      else if (command === '!defend') {
        const player = skills.findPlayerEntity(username);
        if (!player) return bot.chat(`Cannot resolve ${username}. Use !players.`);
        const pos = player.position.clone();
        const limit = parseInt(args[1], 10);
        const targets = Number.isInteger(limit) && limit > 0
          ? getOnlineAgents().slice(0, limit)
          : getOnlineAgents();
        for (const a of targets) await a.orderFollowOrDefend(username, 'defend', pos);
        bot.chat(`${targets.length} bot(s) defending ${username}!`);
      }

      else if (command === '!defendoff' || command === '!unfollow') {
        for (const a of getOnlineAgents()) a.orderClearGuard();
        bot.chat('All bots returned to autonomous survival.');
      }

      else if (command === '!base') {
        const pos = bot.entity.position.clone();
        skills.setBasePosition(pos);
        memory.basePosition = { x: pos.x, y: pos.y, z: pos.z };
        saveMemory();
        bot.chat('Current position saved as base.');
      }

      else if (command === '!return') {
        let base = skills.getBasePosition();
        if (!base && memory.basePosition) {
          base = new Vec3(memory.basePosition.x, memory.basePosition.y, memory.basePosition.z);
          skills.setBasePosition(base);
        }
        if (!base) return bot.chat('No base saved. Use !base first.');
        await interruptCurrentTask('Returning to base');
        skills.useNavigationMovements();
        bot.pathfinder.setGoal(new GoalNear(base.x, base.y, base.z, 2));
        bot.chat('Returning to base.');
      }

      else if (command === '!wood') {
        if (taskRunning) await interruptCurrentTask('Manual wood gathering');
        enqueueTask('manual_wood', 80, () => skills.gatherWood(8));
        bot.chat('Wood gathering queued.');
      }

      else if (command === '!mine') {
        const blockName = args[1];
        if (blockName === 'stop') {
          mining = false;
          await interruptCurrentTask('Mining stopped');
          return bot.chat('Mining stopped.');
        }
        if (!blockName) return bot.chat('Use: !mine iron_ore');
        if (mining) return bot.chat('Already mining.');
        const blockInfo = mcData?.blocksByName[blockName];
        if (!blockInfo) return bot.chat(`Unknown block: ${blockName}`);
        const block = bot.findBlock({ matching: blockInfo.id, maxDistance: 36 });
        if (!block) return bot.chat(`No ${blockName} found nearby.`);

        mining = true;
        await interruptCurrentTask('Manual mining');
        try {
          skills.setGuardUsername(null);
          skills.stopCombat();
          await skills.collectBlockSafely(block, 25000);
          bot.chat(`Collected ${blockName}`);
        } catch (err) {
          bot.chat(`Mining failed: ${err.message.slice(0, 80)}`);
        } finally {
          mining = false;
        }
      }
    });
  }

  bot.on('login', () => {
    if (connectionStatus !== 'online') setConnectionStatus('logged_in');
    console.log(`[BOT] ${username} logged in.`);
  });

  bot.on('kicked', (reason, loggedIn) => {
    disconnectReason = typeof reason === 'string' ? reason : JSON.stringify(reason?.json || reason);
    setConnectionStatus('kicked');
    settleFirstSpawn(false);
    console.log(`[BOT KICKED:${username}]`, loggedIn, disconnectReason);
    if (isLeader) console.dir(reason, { depth: 10 });
  });

  bot.on('end', (reason) => {
    disconnectReason = disconnectReason || String(reason || 'socket closed');
    setConnectionStatus('disconnected');
    settleFirstSpawn(false);
    console.log(`[DISCONNECTED:${username}]`, reason);
    if (brainTimer) { clearInterval(brainTimer); brainTimer = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    // Free chunk caches, listeners & bot object soon after disconnect so GC can reclaim everything
    setTimeout(() => {
      try { bot.removeAllListeners(); } catch {}
      try { bot._client?.removeAllListeners(); } catch {}
    }, 500);
    if (isLeader) {
      saveMemory();
      evo.saveAll();
    }
    // Auto-reconnect on unexpected drop (keepAliveError / socketClosed), unless user stopped swarm or shutting down
    const permanentKick = /banned|whitelist|not white-listed|server is full/i.test(disconnectReason);
    if (!shuttingDown && connectionStatus !== 'stopping' && !permanentKick) {
      if (isLeader) {
        leaderReconnectAttempts += 1;
        if (leaderReconnectAttempts <= 8) {
          console.warn(`[LEADER] Disconnected (${reason}) — reconnecting attempt ${leaderReconnectAttempts}/8 in 9s...`);
          setTimeout(() => {
            if (shuttingDown) return;
            const idx = activeAgents.indexOf(agentHandle);
            if (idx !== -1) activeAgents.splice(idx, 1);
            createBotAgent(0, botRuntimeConfig.BOT_USERNAME, true);
          }, 9000);
        }
      } else {
        const stillInSwarm = activeAgents.includes(agentHandle);
        if (stillInSwarm) {
          console.warn(`[SWARM] ${username} disconnected (${reason}) — re-queuing in 9s...`);
          setTimeout(() => {
            if (shuttingDown) return;
            const idx = activeAgents.indexOf(agentHandle);
            if (idx !== -1) activeAgents.splice(idx, 1);
            const alreadyActive = activeAgents.some(a => a.agentSlot === agentSlot && ['connecting', 'logged_in', 'online'].includes(a.status));
            if (!alreadyActive && !swarmQueue.some(q => q.slot === agentSlot)) {
              swarmQueue.push({ slot: agentSlot, username, retry: 0 });
              drainSwarmQueue().catch(() => {});
            }
          }, 9000);
        }
      }
    }
  });

  bot.on('error', (err) => console.error(`[BOT ERROR:${username}]`, err.message));
  bot.on('messagestr', (msg) => {
    if (isLeader) console.log('[MC SERVER]', msg);
    parseServerDeathMessage(msg);
  });

  agentHandle = {
    username,
    agentSlot,
    isLeader,
    bot,
    skills,
    status: connectionStatus,
    connected: false,
    spawnPromise,
    get disconnectReason() { return disconnectReason; },
    setBrainEnabled: (val) => {
      brainEnabled = val;
      if (!val) {
        skills.setGuardUsername(null);
        skills.clearRevenge();
        skills.stopCombat();
        interruptCurrentTask('Stop').catch(() => {});
      } else if (!brainTimer) {
        startBrain();
      }
    },
    orderFollowOrDefend: async (targetUsername, mode = 'defend', fallbackPos = null) => {
      skills.setGuardOrder(targetUsername, mode, fallbackPos);
      skills.stopCombat();
      await interruptCurrentTask(`${mode} command`);
      const player = skills.findPlayerEntity(targetUsername);
      skills.useNavigationMovements();
      if (player) {
        const dist = mode === 'follow' ? (1.8 + (agentSlot % 3) * 0.6) : (2.4 + (agentSlot % 3) * 0.7);
        bot.pathfinder.setGoal(new GoalFollow(player, dist), true);
      } else if (fallbackPos) {
        bot.pathfinder.setGoal(new GoalNear(Math.floor(fallbackPos.x), Math.floor(fallbackPos.y), Math.floor(fallbackPos.z), 3), true);
      }
    },
    orderCome: async (pos) => {
      if (!pos) return;
      await interruptCurrentTask('Come command');
      skills.stopCombat();
      skills.useNavigationMovements();
      bot.pathfinder.setGoal(new GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), 2));
    },
    orderClearGuard: () => {
      skills.setGuardOrder(null, null, null);
      skills.stopCombat();
      skills.clearMovement();
    },
    disconnect: () => {
      setConnectionStatus('stopping');
      if (brainTimer) { clearInterval(brainTimer); brainTimer = null; }
      if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
      try { bot.quit(); } catch {}
    }
  };

  activeAgents.push(agentHandle);
  return agentHandle;
}

// ========================================
// SWARM & EVOLUTION SCHEDULER
// ========================================

function startEvolutionScheduler() {
  if (swarmEvolveTimer) return;
  lastSwarmEvolutionExperienceCount = evo.getLiveExperienceCount();
  lastEvolutionAt = Date.now();

  swarmEvolveTimer = setInterval(() => {
    const onlineCount = getOnlineAgentCount();
    if (evo.mode === MODES.EVALUATION || onlineCount === 0) return;
    const currentEvidence = evo.getLiveExperienceCount();
    const newEvidence = currentEvidence - lastSwarmEvolutionExperienceCount;
    if (newEvidence < MIN_LIVE_EVIDENCE_PER_GENERATION) return;
    if (Date.now() - lastEvolutionAt < 30000) return;

    evo.activeAgentIndex = (evo.activeAgentIndex + Math.max(1, onlineCount)) % evo.population.length;
    const summary = evo.evolveNextGeneration();
    lastSwarmEvolutionExperienceCount = currentEvidence;
    lastEvolutionAt = Date.now();
    saveMemory();
    console.log(evo.formatDashboard(summary, onlineCount));

    const leader = activeAgents.find(a => a.isLeader && a.status === 'online')?.bot || getOnlineAgents()[0]?.bot;
    if (leader?.entity) {
      leader.chat(`[E-HRL] Gen ${summary.generation} evolved (${newEvidence} outcomes, vel=${summary.learningVelocity}x, fit=${(summary.bestFitness * 100).toFixed(1)}%)`);
    }
  }, 12000);
}

async function drainSwarmQueue() {
  if (swarmQueueRunning) return;
  swarmQueueRunning = true;
  const queueEpoch = swarmQueueEpoch;

  try {
    const leader = activeAgents.find(agent => agent.isLeader);
    if (leader && leader.status !== 'online') {
      const leaderReady = await Promise.race([
        leader.spawnPromise,
        sleep(SWARM_SPAWN_TIMEOUT_MS).then(() => false)
      ]);
      if (!leaderReady) {
        console.warn('[SWARM] Leader has not spawned; additional agents will wait.');
        return;
      }
      await sleep(SWARM_CONNECT_DELAY_MS);
    }

    while (swarmQueue.length && queueEpoch === swarmQueueEpoch) {
      const next = swarmQueue.shift();
      const existing = activeAgents.find(agent => agent.agentSlot === next.slot &&
        ['connecting', 'logged_in', 'online'].includes(agent.status));
      if (existing) continue;

      for (let i = activeAgents.length - 1; i >= 0; i--) {
        if (activeAgents[i].agentSlot === next.slot &&
            ['disconnected', 'kicked', 'stopping'].includes(activeAgents[i].status)) {
          activeAgents.splice(i, 1);
        }
      }

      const handle = createBotAgent(next.slot, next.username, false);
      const outcome = await Promise.race([
        handle.spawnPromise,
        sleep(SWARM_SPAWN_TIMEOUT_MS).then(() => 'timeout')
      ]);

      if (outcome !== true) {
        const reason = handle.disconnectReason || (outcome === 'timeout' ? 'spawn timeout' : 'connection ended');
        console.warn(`[SWARM] ${next.username} did not spawn: ${reason}`);
        if (/connection throttled/i.test(reason) && (next.retry || 0) < 1) {
          await sleep(SWARM_CONNECT_DELAY_MS);
          if (queueEpoch === swarmQueueEpoch) {
            swarmQueue.unshift({ ...next, retry: (next.retry || 0) + 1 });
          }
        } else if (outcome === 'timeout') {
          handle.disconnect();
        }
      }

      if (swarmQueue.length && queueEpoch === swarmQueueEpoch) {
        await sleep(SWARM_CONNECT_DELAY_MS);
      }
    }
  } finally {
    swarmQueueRunning = false;
    if (swarmQueue.length) {
      setImmediate(() => drainSwarmQueue().catch(err => console.error('[SWARM QUEUE]', err)));
    }
  }
}

function startSwarm(targetCount) {
  const desired = Math.max(1, Math.min(20, Number.parseInt(targetCount, 10) || 1));
  // Always guarantee a leader brain is (re)spawned first — even after a full Stop ALL
  ensureLeaderSpawned();
  lastSwarmEvolutionExperienceCount = evo.getLiveExperienceCount();

  const reservedSlots = new Set(
    activeAgents
      .filter(agent => ['connecting', 'logged_in', 'online'].includes(agent.status))
      .map(agent => agent.agentSlot)
  );
  for (const item of swarmQueue) reservedSlots.add(item.slot);

  for (let slot = 1; slot < desired; slot++) {
    if (reservedSlots.has(slot)) continue;
    const suffix = String(slot + 1).padStart(2, '0');
    swarmQueue.push({ slot, username: `${botRuntimeConfig.BOT_USERNAME}_${suffix}`, retry: 0 });
  }

  startEvolutionScheduler();
  drainSwarmQueue().catch(err => console.error('[SWARM QUEUE]', err));
}

// Named swarm: user chooses a separate custom name for EVERY bot from the web dashboard
function startSwarmNamed(names) {
  // Sanitize to valid offline-mode MC usernames (letters/digits/underscore, max 16)
  const sanitized = [];
  const seen = new Set();
  for (const raw of (Array.isArray(names) ? names : [])) {
    const name = String(raw).trim().replace(/[^A-Za-z0-9_.]/g, '').replace(/^\.+/, '').slice(0, 16);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push(name);
  }
  if (!sanitized.length) return { ok: false, error: 'कोई valid नाम नहीं मिला' };

  const activeStatuses = ['connecting', 'logged_in', 'online'];
  const usedNames = new Set(
    activeAgents.filter(a => activeStatuses.includes(a.status)).map(a => a.username.toLowerCase())
  );
  for (const q of swarmQueue) usedNames.add(q.username.toLowerCase());

  const fresh = sanitized.filter(n => !usedNames.has(n.toLowerCase()));
  if (!fresh.length) return { ok: false, error: 'सभी नाम पहले से active/queued हैं' };

  // 1) Guarantee leader brain: अगर leader offline है तो पहला नाम leader बनेगा
  let leaderName = null;
  const activeLeader = activeAgents.find(a => a.isLeader && activeStatuses.includes(a.status));
  if (!activeLeader) {
    leaderName = fresh.shift();
    for (let i = activeAgents.length - 1; i >= 0; i--) {
      if (activeAgents[i].isLeader) activeAgents.splice(i, 1);
    }
    leaderReconnectAttempts = 0;
    createBotAgent(0, leaderName, true);
  }

  // 2) बाकी नाम free slots पर queue होंगे
  const reservedSlots = new Set(
    activeAgents.filter(a => activeStatuses.includes(a.status)).map(a => a.agentSlot)
  );
  for (const q of swarmQueue) reservedSlots.add(q.slot);

  const queued = [];
  let slot = 1;
  for (const name of fresh) {
    while (reservedSlots.has(slot) && slot < 20) slot++;
    if (slot >= 20) break;
    reservedSlots.add(slot);
    swarmQueue.push({ slot, username: name, retry: 0 });
    queued.push(name);
    slot++;
  }

  startEvolutionScheduler();
  drainSwarmQueue().catch(err => console.error('[SWARM QUEUE]', err));
  return { ok: true, leader: leaderName || (activeLeader ? activeLeader.username : null), queued };
}

function stopSwarm() {
  swarmQueueEpoch++;
  swarmQueue = [];
  for (const agent of [...activeAgents]) {
    if (agent.isLeader) continue;
    try { agent.disconnect(); } catch {}
    const idx = activeAgents.indexOf(agent);
    if (idx !== -1) activeAgents.splice(idx, 1);
  }
}

function startArenaTrainer(leaderBot) {
  if (arenaTimer) clearInterval(arenaTimer);
  arenaTimer = setInterval(() => {
    if (!arenaControlEnabled || !leaderBot.entity) return;
    const roll = Math.random();
    if (roll < 0.34) {
      const online = getOnlineAgents();
      const target = online[Math.floor(Math.random() * online.length)];
      if (target?.bot?.entity) {
        leaderBot.chat(`/give ${target.username} water_bucket 1`);
        leaderBot.chat(`/tp ${target.username} ~ ~22 ~`);
      }
    } else if (roll < 0.68) {
      leaderBot.chat('/summon zombie ~6 ~ ~6');
    } else {
      leaderBot.chat('/time set night');
    }
  }, 30000);
}

// ========================================
// BOOTSTRAP
// ========================================

if (UI_ONLY_MODE) {
  console.log('[WEB] UI-ONLY mode: koi bot auto-connect nahi hoga — Dashboard se "Connect Leader" ya "Start Named Swarm" use karo.');
  if (INITIAL_SWARM_COUNT > 1) console.log('[WEB] Note: --swarm flag UI-ONLY mode me ignore hua.');
} else {
  createBotAgent(0, botRuntimeConfig.BOT_USERNAME, true);
  startEvolutionScheduler();
  if (INITIAL_SWARM_COUNT > 1) {
    evo.setMode(MODES.TRAINING);
    startSwarm(INITIAL_SWARM_COUNT);
  }
}

// ========================================
// WEB CONTROL HELPERS (used by webui.js dashboard)
// ========================================

function ensureLeaderSpawned() {
  const activeLeader = activeAgents.find(a => a.isLeader && ['connecting', 'logged_in', 'online'].includes(a.status));
  if (activeLeader) return { ok: true, already: true, username: activeLeader.username };
  for (let i = activeAgents.length - 1; i >= 0; i--) {
    if (activeAgents[i].isLeader) activeAgents.splice(i, 1);
  }
  leaderReconnectAttempts = 0;
  const handle = createBotAgent(0, botRuntimeConfig.BOT_USERNAME, true);
  return { ok: true, username: handle.username };
}

function disconnectBotByUsername(username) {
  const handle = activeAgents.find(a => a.username === username);
  if (!handle) return { ok: false, error: `Bot not found: ${username}` };
  handle.disconnect();
  const idx = activeAgents.indexOf(handle);
  if (idx !== -1) activeAgents.splice(idx, 1);
  console.log(`[WEB] Disconnected bot: ${username}`);
  return { ok: true, username };
}

function stopAllBots(includeLeader = false) {
  swarmQueueEpoch++;
  swarmQueue = [];
  for (const agent of [...activeAgents]) {
    if (!includeLeader && agent.isLeader) continue;
    try { agent.disconnect(); } catch {}
    const idx = activeAgents.indexOf(agent);
    if (idx !== -1) activeAgents.splice(idx, 1);
  }
  return { ok: true };
}

function webSendChat(target, message) {
  const text = String(message || '').slice(0, 240);
  if (!text) return { ok: false, error: 'Empty message' };
  let handle = null;
  if (target === 'leader' || !target) {
    handle = activeAgents.find(a => a.isLeader) || getOnlineAgents()[0];
  } else {
    handle = activeAgents.find(a => a.username === target);
  }
  if (!handle?.bot?.entity) return { ok: false, error: `Bot offline: ${target || 'leader'}` };
  handle.bot.chat(text);
  console.log(`[WEB] ${handle.username} chat: ${text}`);
  return { ok: true, username: handle.username, message: text };
}

// ========================================
// WEB CONTROL DASHBOARD (live bots, connect/disconnect, config editor)
// ========================================

try {
  require('./webui').startWebUI({
    port: Number.parseInt(process.env.WEB_PORT || '3000', 10) || 3000,
    getBotConfig: () => ({ ...botRuntimeConfig }),
    setBotConfig: (patch) => {
      if (patch.SERVER_HOST !== undefined) botRuntimeConfig.SERVER_HOST = String(patch.SERVER_HOST).trim();
      if (patch.SERVER_PORT !== undefined) {
        const p = Number.parseInt(patch.SERVER_PORT, 10);
        if (p > 0 && p < 65536) botRuntimeConfig.SERVER_PORT = p;
      }
      if (patch.BOT_USERNAME !== undefined) botRuntimeConfig.BOT_USERNAME = String(patch.BOT_USERNAME).trim() || botRuntimeConfig.BOT_USERNAME;
      if (patch.OWNER_USERNAME !== undefined) botRuntimeConfig.OWNER_USERNAME = String(patch.OWNER_USERNAME).trim();
      if (Array.isArray(patch.FRIENDLY_PLAYERS)) {
        botRuntimeConfig.FRIENDLY_PLAYERS = patch.FRIENDLY_PLAYERS.map(v => String(v).trim()).filter(Boolean);
      }
      saveBotConfig();
      return { ...botRuntimeConfig };
    },
    agents: () => activeAgents,
    ensureLeader: ensureLeaderSpawned,
    startSwarm: (count) => {
      evo.setMode(MODES.TRAINING);
      startSwarm(count);
      return { ok: true, count };
    },
    startSwarmNamed: (names) => {
      evo.setMode(MODES.TRAINING);
      return startSwarmNamed(names);
    },
    stopSwarmOnly: () => { stopSwarm(); return { ok: true }; },
    stopAll: (includeLeader) => stopAllBots(includeLeader),
    disconnectBot: disconnectBotByUsername,
    sendChat: webSendChat,
    getMemoryInfo: () => ({ stage: memory.stage, decisions: memory.decisions, completed: Object.keys(memory.completedTasks).length, failed: Object.keys(memory.failedTasks).length }),
    getEvoInfo: () => ({ generation: evo.generation, mode: evo.mode, experiences: evo.experiences.length, population: evo.population.length })
  });
} catch (err) {
  console.warn('[WEB] Dashboard failed to start:', err.message);
}

// ========================================
// REAL-TIME MEMORY WATCHDOG & AUTO-GUARD
// ========================================

setInterval(() => {
  const mu = process.memoryUsage();
  const heapMB = Math.round(mu.heapUsed / 1048576);
  const rssMB = Math.round(mu.rss / 1048576);
  const extMB = Math.round(mu.external / 1048576);

  const botStats = activeAgents.map(a => {
    const cols = a.bot?.world?.columns
      ? (typeof a.bot.world.columns.size === 'number' ? a.bot.world.columns.size : Object.keys(a.bot.world.columns).length)
      : 0;
    const invL = a.bot?.inventory?.listenerCount ? a.bot.inventory.listenerCount('updateSlot') : 0;
    return `${a.username}(${a.status},chunks=${cols},invL=${invL})`;
  }).join(' | ');

  if (heapMB > 350 || Date.now() % 20000 < 5000) {
    console.log(`[MEM] heap=${heapMB}MB rss=${rssMB}MB ext=${extMB}MB | exp=${evo.experiences.length} | ${botStats}`);
  }

  // Emergency relief if heap ever spikes near 2.2 GB
  if (heapMB > 2200) {
    console.warn(`[MEM GUARD] High heap (${heapMB}MB)! Clearing pathfinder goals & caches...`);
    for (const a of activeAgents) {
      try { a.skills.clearMovement(); } catch {}
    }
    swarmSharedContext.discoveries.length = 0;
    if (typeof global.gc === 'function') global.gc();
  }
}, 5000);

process.on('SIGINT', () => {
  shuttingDown = true;
  saveMemory();
  evo.saveAll();
  for (const a of activeAgents) a.disconnect();
  process.exit(0);
});

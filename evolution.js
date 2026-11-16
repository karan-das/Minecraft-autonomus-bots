const fs = require('fs');
const path = require('path');

const SKILLS = [
  'mlg',
  'pvp',
  'traps',
  'defense',
  'parkour',
  'building',
  'survival',
  'exploration',
  'cooperation'
];

const MODES = {
  LIVE: 'LIVE',
  TRAINING: 'TRAINING',
  EVALUATION: 'EVALUATION'
};

const INPUT_SIZE = 22;
const TRUNK_SIZE = 20;
const HEAD_PARAMS = 4;
const CRITIC_HIDDEN = 16;
const BENCHMARK_SEED = 42;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function tanh(x) {
  return Math.tanh(clamp(x, -12, 12));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-clamp(x, -18, 18)));
}

function gaussianRandom() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function readJSONSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[EVO STORAGE] Corrupt file (${path.basename(filePath)}): ${err.message}`);
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, `${filePath}.corrupt.${Date.now()}`);
      }
    } catch {}
    return fallback;
  }
}

function writeAtomicJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function createEmptySkillStats() {
  const stats = {};
  for (const skill of SKILLS) {
    stats[skill] = {
      score: 0,
      attempts: 0,
      successes: 0,
      failures: 0,
      avgReward: 0,
      lastEvaluatedGen: 0
    };
  }
  return stats;
}

function createEmptyLiveMetrics() {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    deaths: 0,
    damageDealt: 0,
    damageTaken: 0,
    critsLanded: 0,
    kills: 0,
    resourcesGathered: 0,
    itemsCrafted: 0,
    coopHelps: 0,
    parkourSuccesses: 0,
    maxStageReached: 1,
    totalReward: 0
  };
}

/**
 * Modular Actor-Critic Neural Architecture:
 * - Shared contextual trunk: INPUT_SIZE (22) -> TRUNK_SIZE (20), tanh
 * - 9 modular skill heads: TRUNK_SIZE (20) -> HEAD_PARAMS (4), sigmoid
 * - Separate Value Critic: INPUT_SIZE (22) -> CRITIC_HIDDEN (16) -> 1, linear
 *
 * Modular heads completely avoid the permutation/catastrophic-forgetting problem
 * and allow Skill-Head Grafting across specialist bots in the swarm.
 */
class ModularNeuralBrain {
  constructor(arch = null) {
    const trunkWLen = INPUT_SIZE * TRUNK_SIZE;
    const headWLen = TRUNK_SIZE * HEAD_PARAMS;
    const criticW1Len = INPUT_SIZE * CRITIC_HIDDEN;

    if (
      arch &&
      Array.isArray(arch.trunkW) && arch.trunkW.length === trunkWLen &&
      Array.isArray(arch.trunkB) && arch.trunkB.length === TRUNK_SIZE &&
      arch.heads &&
      SKILLS.every(sk => Array.isArray(arch.heads[sk]?.w) && arch.heads[sk].w.length === headWLen)
    ) {
      this.trunkW = arch.trunkW.slice();
      this.trunkB = arch.trunkB.slice();
      this.heads = {};
      for (const sk of SKILLS) {
        this.heads[sk] = {
          w: arch.heads[sk].w.slice(),
          b: arch.heads[sk].b.slice()
        };
      }
      if (Array.isArray(arch.criticW1) && arch.criticW1.length === criticW1Len) {
        this.criticW1 = arch.criticW1.slice();
        this.criticB1 = arch.criticB1.slice();
        this.criticW2 = arch.criticW2.slice();
        this.criticB2 = Number(arch.criticB2) || 0;
      } else {
        this._initCritic();
      }
    } else {
      const sTrunk = Math.sqrt(2 / (INPUT_SIZE + TRUNK_SIZE));
      const sHead = Math.sqrt(2 / (TRUNK_SIZE + HEAD_PARAMS));
      this.trunkW = Array.from({ length: trunkWLen }, () => gaussianRandom() * sTrunk);
      this.trunkB = Array.from({ length: TRUNK_SIZE }, () => gaussianRandom() * 0.05);
      this.heads = {};
      for (const sk of SKILLS) {
        this.heads[sk] = {
          w: Array.from({ length: headWLen }, () => gaussianRandom() * sHead),
          b: Array.from({ length: HEAD_PARAMS }, () => gaussianRandom() * 0.05)
        };
      }
      this._initCritic();
    }
  }

  _initCritic() {
    const sC1 = Math.sqrt(2 / (INPUT_SIZE + CRITIC_HIDDEN));
    const sC2 = Math.sqrt(1 / CRITIC_HIDDEN);
    this.criticW1 = Array.from({ length: INPUT_SIZE * CRITIC_HIDDEN }, () => gaussianRandom() * sC1);
    this.criticB1 = new Array(CRITIC_HIDDEN).fill(0);
    this.criticW2 = Array.from({ length: CRITIC_HIDDEN }, () => gaussianRandom() * sC2);
    this.criticB2 = 0;
  }

  toJSON() {
    return {
      trunkW: this.trunkW,
      trunkB: this.trunkB,
      heads: this.heads,
      criticW1: this.criticW1,
      criticB1: this.criticB1,
      criticW2: this.criticW2,
      criticB2: this.criticB2
    };
  }

  encodeTrunk(inputs) {
    const x = new Array(INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE; i++) {
      x[i] = clamp(Number(inputs?.[i]) || 0, -2, 2);
    }
    const h = new Array(TRUNK_SIZE);
    for (let j = 0; j < TRUNK_SIZE; j++) {
      let sum = this.trunkB[j];
      for (let i = 0; i < INPUT_SIZE; i++) {
        sum += x[i] * this.trunkW[i * TRUNK_SIZE + j];
      }
      h[j] = tanh(sum);
    }
    return { x, h };
  }

  forwardHead(skill, hidden) {
    const head = this.heads[skill];
    if (!head) return [0.5, 0.5, 0.5, 0.5];
    const params = new Array(HEAD_PARAMS);
    for (let p = 0; p < HEAD_PARAMS; p++) {
      let sum = head.b[p];
      for (let j = 0; j < TRUNK_SIZE; j++) {
        sum += hidden[j] * head.w[j * HEAD_PARAMS + p];
      }
      params[p] = sigmoid(sum);
    }
    return params;
  }

  decideSkill(skill, inputs) {
    const { h } = this.encodeTrunk(inputs);
    return this.forwardHead(skill, h);
  }

  forward(inputs) {
    const { h } = this.encodeTrunk(inputs);
    const out = {};
    for (const sk of SKILLS) out[sk] = this.forwardHead(sk, h);
    return out;
  }

  evaluateValue(inputs) {
    const x = new Array(INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE; i++) {
      x[i] = clamp(Number(inputs?.[i]) || 0, -2, 2);
    }
    const ch = new Array(CRITIC_HIDDEN);
    for (let j = 0; j < CRITIC_HIDDEN; j++) {
      let sum = this.criticB1[j];
      for (let i = 0; i < INPUT_SIZE; i++) {
        sum += x[i] * this.criticW1[i * CRITIC_HIDDEN + j];
      }
      ch[j] = tanh(sum);
    }
    let val = this.criticB2;
    for (let j = 0; j < CRITIC_HIDDEN; j++) {
      val += ch[j] * this.criticW2[j];
    }
    return { x, ch, val };
  }

  /**
   * True Online Advantage Actor-Critic update (with gradient clipping + entropy guard).
   * Positive advantage reinforces the taken continuous action vector;
   * negative advantage pushes policy away from the failed action while keeping exploration alive.
   */
  applyActorCriticStep(skill, inputs, actionParams, reward, lrActor = 0.035, lrCritic = 0.045) {
    const head = this.heads[skill];
    if (!head || !Array.isArray(inputs) || !Array.isArray(actionParams)) return 0;

    // 1. Critic update: minimize (R - V(s))^2
    const { x, ch, val } = this.evaluateValue(inputs);
    const advantage = clamp(reward - val, -5, 5);

    const dCriticOut = clamp(-advantage, -2.5, 2.5);
    const dCriticHidden = new Array(CRITIC_HIDDEN).fill(0);
    for (let j = 0; j < CRITIC_HIDDEN; j++) {
      dCriticHidden[j] = dCriticOut * this.criticW2[j] * (1 - ch[j] * ch[j]);
      this.criticW2[j] = clamp(this.criticW2[j] - lrCritic * dCriticOut * ch[j], -4, 4);
    }
    this.criticB2 = clamp(this.criticB2 - lrCritic * dCriticOut, -4, 4);

    for (let j = 0; j < CRITIC_HIDDEN; j++) {
      const gj = clamp(dCriticHidden[j], -1.5, 1.5);
      this.criticB1[j] = clamp(this.criticB1[j] - lrCritic * gj, -4, 4);
      for (let i = 0; i < INPUT_SIZE; i++) {
        this.criticW1[i * CRITIC_HIDDEN + j] = clamp(
          this.criticW1[i * CRITIC_HIDDEN + j] - lrCritic * gj * x[i],
          -4,
          4
        );
      }
    }

    // 2. Actor update using Advantage A = R - V(s)
    const { h } = this.encodeTrunk(inputs);
    const pred = this.forwardHead(skill, h);
    const dHidden = new Array(TRUNK_SIZE).fill(0);

    for (let p = 0; p < HEAD_PARAMS; p++) {
      const target = clamp(Number(actionParams[p]) || 0.5, 0.05, 0.95);
      const y = pred[p];
      const sigDeriv = Math.max(0.05, y * (1 - y));
      // Policy gradient: if advantage > 0, move y -> target; if advantage < 0, move y away from target
      const dir = advantage >= 0 ? (target - y) : (y - target);
      const entropyPull = 0.015 * (0.5 - y); // Prevents dead saturated neurons
      const gradLogit = clamp((dir * Math.abs(advantage) + entropyPull) * sigDeriv, -1.2, 1.2);

      head.b[p] = clamp(head.b[p] + lrActor * gradLogit, -4.5, 4.5);
      for (let j = 0; j < TRUNK_SIZE; j++) {
        dHidden[j] += gradLogit * head.w[j * HEAD_PARAMS + p];
        head.w[j * HEAD_PARAMS + p] = clamp(
          head.w[j * HEAD_PARAMS + p] * 0.9995 + lrActor * gradLogit * h[j],
          -4.5,
          4.5
        );
      }
    }

    // 3. Backprop lightly into shared trunk (prevents destabilizing other skill heads)
    const trunkLR = lrActor * 0.25;
    for (let j = 0; j < TRUNK_SIZE; j++) {
      const gTrunk = clamp(dHidden[j] * (1 - h[j] * h[j]), -0.8, 0.8);
      this.trunkB[j] = clamp(this.trunkB[j] + trunkLR * gTrunk, -4, 4);
      for (let i = 0; i < INPUT_SIZE; i++) {
        this.trunkW[i * TRUNK_SIZE + j] = clamp(
          this.trunkW[i * TRUNK_SIZE + j] * 0.9998 + trunkLR * gTrunk * x[i],
          -4,
          4
        );
      }
    }

    return advantage;
  }
}

class EvolutionSystem {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.evoDir = path.join(this.rootDir, 'data', 'evolution');
    this.memDir = path.join(this.rootDir, 'memory');

    this.populationSize = options.populationSize || 32;
    this.eliteCount = options.eliteCount || 5;
    this.mutationRate = options.mutationRate || 0.16;
    this.mutationSigma = options.mutationSigma || 0.22;
    this.skillSigmas = Object.fromEntries(SKILLS.map(s => [s, this.mutationSigma]));

    this.mode = MODES.TRAINING;
    this.generation = 1;
    this.population = [];
    this.bestOverall = null;
    this.skillChampions = {};
    this.generationHistory = [];
    this.fitnessHistory = [];
    this.innovationHistory = [];

    this.experiences = [];
    this.failureHistory = [];
    this.successfulStrategies = [];
    this.replayBuffer = [];
    this.sharedSkillStats = createEmptySkillStats();
    this.sharedExperienceCount = 0;
    this.learningVelocity = 1.0;
    this.milestoneUnlocked = {};

    this.environmentModel = {
      deathCount: 0,
      lastLesson: null,
      dangerProfiles: {},
      skillAdjustments: {
        retreatBiasBoost: 0,
        dodgeBoost: 0,
        creeperMarginBoost: 0,
        mlgTriggerBoost: 0,
        stuckCautionBoost: 0
      },
      replayScenarios: []
    };

    this.activeAgentIndex = 0;
    this._brainCache = new Map();
    this.loadAll();
  }

  ensureDirs() {
    fs.mkdirSync(this.evoDir, { recursive: true });
    fs.mkdirSync(this.memDir, { recursive: true });
  }

  createGenome(id, arch = null, parents = []) {
    const brain = new ModularNeuralBrain(arch);
    return {
      version: 3,
      id,
      generation: this.generation,
      parents,
      arch: brain.toJSON(),
      fitness: 0,
      overallScore: 0,
      minSkillScore: 0,
      diversityScore: 0,
      liveFitness: 0,
      validated: false,
      skills: createEmptySkillStats(),
      liveMetrics: createEmptyLiveMetrics()
    };
  }

  isValidV3Genome(g) {
    return Boolean(
      g &&
      g.version === 3 &&
      g.arch &&
      Array.isArray(g.arch.trunkW) &&
      g.arch.trunkW.length === INPUT_SIZE * TRUNK_SIZE &&
      g.arch.heads &&
      SKILLS.every(sk => Array.isArray(g.arch.heads[sk]?.w))
    );
  }

  initializePopulation() {
    this.generation = 1;
    this.population = [];
    for (let i = 0; i < this.populationSize; i++) {
      const id = `GEN001_AGENT_${String(i + 1).padStart(2, '0')}`;
      this.population.push(this.createGenome(id));
    }
    this.bestOverall = this.population[0];
    for (const skill of SKILLS) {
      this.skillChampions[skill] = this.population[0];
    }
  }

  loadAll() {
    this.ensureDirs();

    const popData = readJSONSafe(path.join(this.evoDir, 'population.json'), null);
    if (
      popData &&
      Array.isArray(popData.population) &&
      popData.population.length > 0 &&
      this.isValidV3Genome(popData.population[0])
    ) {
      this.generation = popData.generation || 1;
      this.population = popData.population;
      this.populationSize = popData.population.length;
      if (popData.skillSigmas) {
        this.skillSigmas = { ...this.skillSigmas, ...popData.skillSigmas };
      }
      this.learningVelocity = Number(popData.learningVelocity) || 1.0;
      this.milestoneUnlocked = popData.milestoneUnlocked || {};
    } else {
      if (popData) {
        console.log('[EVO] Upgrading saved v2 population to Modular Actor-Critic v3 architecture while keeping memories.');
      }
      this.initializePopulation();
    }

    const loadedBest = readJSONSafe(path.join(this.evoDir, 'best_overall.json'), null);
    this.bestOverall = this.isValidV3Genome(loadedBest) ? loadedBest : this.population[0];

    const loadedChamps = readJSONSafe(path.join(this.evoDir, 'skill_champions.json'), {});
    this.skillChampions = {};
    for (const skill of SKILLS) {
      this.skillChampions[skill] = this.isValidV3Genome(loadedChamps?.[skill])
        ? loadedChamps[skill]
        : this.bestOverall;
    }

    this.generationHistory = readJSONSafe(path.join(this.evoDir, 'generation_history.json'), []);
    this.fitnessHistory = readJSONSafe(path.join(this.evoDir, 'fitness_history.json'), []);
    this.innovationHistory = readJSONSafe(path.join(this.evoDir, 'innovation_history.json'), []);

    this.experiences = readJSONSafe(path.join(this.memDir, 'experience.json'), []);
    this.failureHistory = readJSONSafe(path.join(this.memDir, 'failure_history.json'), []);
    this.successfulStrategies = readJSONSafe(path.join(this.memDir, 'successful_strategies.json'), []);
    this.replayBuffer = readJSONSafe(path.join(this.memDir, 'prioritized_replay.json'), []);
    this.sharedSkillStats = readJSONSafe(path.join(this.memDir, 'shared_skill_stats.json'), createEmptySkillStats());
    this.sharedExperienceCount = readJSONSafe(path.join(this.memDir, 'shared_experience_count.json'), 0);

    for (const skill of SKILLS) {
      if (!this.sharedSkillStats[skill]) {
        this.sharedSkillStats[skill] = createEmptySkillStats()[skill];
      }
    }

    const envSaved = readJSONSafe(path.join(this.memDir, 'environment_model.json'), null);
    if (envSaved) {
      this.environmentModel = {
        ...this.environmentModel,
        ...envSaved,
        skillAdjustments: {
          ...this.environmentModel.skillAdjustments,
          ...(envSaved.skillAdjustments || {})
        },
        dangerProfiles: envSaved.dangerProfiles || {},
        replayScenarios: envSaved.replayScenarios || []
      };
    }

    if (this.generationHistory.length === 0) {
      this.evaluateGeneration(BENCHMARK_SEED);
    }
  }

  saveAll() {
    this.ensureDirs();
    writeAtomicJSON(path.join(this.evoDir, 'population.json'), {
      version: 3,
      generation: this.generation,
      learningVelocity: this.learningVelocity,
      skillSigmas: this.skillSigmas,
      milestoneUnlocked: this.milestoneUnlocked,
      savedAt: new Date().toISOString(),
      population: this.population
    });
    writeAtomicJSON(path.join(this.evoDir, 'best_overall.json'), this.bestOverall);
    writeAtomicJSON(path.join(this.evoDir, 'skill_champions.json'), this.skillChampions);
    writeAtomicJSON(path.join(this.evoDir, 'generation_history.json'), this.generationHistory.slice(-200));
    writeAtomicJSON(path.join(this.evoDir, 'fitness_history.json'), this.fitnessHistory.slice(-200));
    writeAtomicJSON(path.join(this.evoDir, 'innovation_history.json'), this.innovationHistory.slice(-200));

    writeAtomicJSON(path.join(this.memDir, 'experience.json'), this.experiences.slice(-500));
    writeAtomicJSON(path.join(this.memDir, 'failure_history.json'), this.failureHistory.slice(-300));
    writeAtomicJSON(path.join(this.memDir, 'successful_strategies.json'), this.successfulStrategies.slice(-300));
    writeAtomicJSON(path.join(this.memDir, 'prioritized_replay.json'), this.replayBuffer.slice(-350));
    writeAtomicJSON(path.join(this.memDir, 'shared_skill_stats.json'), this.sharedSkillStats);
    writeAtomicJSON(path.join(this.memDir, 'shared_experience_count.json'), this.sharedExperienceCount);
    writeAtomicJSON(path.join(this.memDir, 'environment_model.json'), {
      ...this.environmentModel,
      replayScenarios: (this.environmentModel.replayScenarios || []).slice(-50)
    });
  }

  setMode(newMode) {
    const upper = String(newMode || '').toUpperCase();
    if (!MODES[upper]) return false;
    this.mode = MODES[upper];
    return true;
  }

  getGenomeForBot(agentSlot = 0) {
    if (this.mode === MODES.LIVE && agentSlot === 0) {
      return this.bestOverall || this.population[0];
    }
    const idx = (this.activeAgentIndex + agentSlot) % this.population.length;
    return this.population[idx] || this.bestOverall || this.population[0];
  }

  getActiveGenome() {
    return this.getGenomeForBot(0);
  }

  getEntityDanger(name) {
    if (!name) return 0;
    const p = this.environmentModel.dangerProfiles[name];
    return p ? clamp(p.threatScore || 0, 0, 1) : 0;
  }

  recordThreatEncounter(entityName, damageTaken = 0) {
    if (!entityName) return;
    const map = this.environmentModel.dangerProfiles;
    if (!map[entityName]) {
      map[entityName] = { deaths: 0, hitsTaken: 0, threatScore: 0.25 };
    }
    const entry = map[entityName];
    entry.hitsTaken += 1;
    entry.threatScore = clamp(entry.threatScore + 0.04 + damageTaken / 40, 0.1, 1.0);
  }

  decideSkill(skill, stateVector, contextName = null, agentSlot = 0) {
    const genome = this.getGenomeForBot(agentSlot);
    let brain = this._brainCache.get(genome.id);
    if (!brain) {
      brain = new ModularNeuralBrain(genome.arch);
      this._brainCache.set(genome.id, brain);
      if (this._brainCache.size > 40) this._brainCache.clear();
    }
    const params = brain.decideSkill(skill, stateVector);

    // Exploration noise in TRAINING mode proportional to per-skill adaptive sigma
    if (this.mode === MODES.TRAINING) {
      const exploreScale = clamp((this.skillSigmas[skill] || 0.18) * 0.28, 0.02, 0.09);
      for (let p = 0; p < params.length; p++) {
        params[p] = clamp(params[p] + gaussianRandom() * exploreScale, 0.02, 0.98);
      }
    }

    const adj = this.environmentModel.skillAdjustments;
    const entityDanger = this.getEntityDanger(contextName);

    if (skill === 'pvp') {
      params[1] = clamp(params[1] + adj.dodgeBoost + entityDanger * 0.18, 0, 1);
      params[3] = clamp(params[3] + adj.retreatBiasBoost + entityDanger * 0.16, 0, 1);
    } else if (skill === 'mlg') {
      params[0] = clamp(params[0] + adj.mlgTriggerBoost, 0, 1);
    } else if (skill === 'defense') {
      params[0] = clamp(params[0] + entityDanger * 0.15, 0, 1);
      params[1] = clamp(params[1] + entityDanger * 0.15, 0, 1);
    }

    return params;
  }

  recordAgentMilestone(agentSlot, milestoneName, stage = 1, rewardBonus = 2.0) {
    const genome = this.getGenomeForBot(agentSlot);
    if (!genome.liveMetrics) genome.liveMetrics = createEmptyLiveMetrics();
    genome.liveMetrics.maxStageReached = Math.max(genome.liveMetrics.maxStageReached || 1, stage);
    genome.liveMetrics.totalReward += rewardBonus;

    const isFirstTime = !this.milestoneUnlocked[milestoneName];
    this.milestoneUnlocked[milestoneName] = (this.milestoneUnlocked[milestoneName] || 0) + 1;

    // Exponential milestone multiplier for first global unlock
    const multiplier = isFirstTime ? Math.pow(1.45, Math.min(6, stage)) : 1.0;
    const totalBonus = Number((rewardBonus * multiplier).toFixed(2));

    this.innovationHistory.push({
      generation: this.generation,
      agentId: genome.id,
      milestone: milestoneName,
      stage,
      firstTime: isFirstTime,
      bonus: totalBonus,
      timestamp: new Date().toISOString()
    });

    this.saveAll();
    return totalBonus;
  }

  recordExperience({
    skill,
    situation,
    actionParams,
    success,
    reward = null,
    healthDelta = 0,
    resourcesUsed = 0,
    evidence = null,
    stateVector = null,
    agentSlot = 0,
    metricUpdates = null
  }) {
    const genome = this.getGenomeForBot(agentSlot);
    if (!genome.skills[skill]) return;
    if (!genome.liveMetrics) genome.liveMetrics = createEmptyLiveMetrics();

    const s = genome.skills[skill];
    const shared = this.sharedSkillStats[skill] || (this.sharedSkillStats[skill] = createEmptySkillStats()[skill]);
    this.sharedExperienceCount += 1;

    // Compute rich continuous reward if caller didn't supply explicit reward
    const computedReward = reward !== null
      ? Number(reward)
      : (success ? 1.0 : -0.75) + clamp(healthDelta / 10, -1.5, 0.8) + (metricUpdates?.critsLanded ? metricUpdates.critsLanded * 0.45 : 0);

    shared.attempts += 1;
    if (success) shared.successes += 1;
    else shared.failures += 1;
    shared.avgReward = Number((shared.avgReward * 0.92 + computedReward * 0.08).toFixed(4));
    shared.score = Number((shared.successes / Math.max(1, shared.attempts)).toFixed(4));
    shared.lastEvaluatedGen = this.generation;

    s.attempts += 1;
    if (success) s.successes += 1;
    else s.failures += 1;
    s.avgReward = Number(((s.avgReward || 0) * 0.85 + computedReward * 0.15).toFixed(4));
    s.lastEvaluatedGen = this.generation;

    genome.liveMetrics.attempts += 1;
    if (success) genome.liveMetrics.successes += 1;
    else genome.liveMetrics.failures += 1;
    genome.liveMetrics.totalReward = Number((genome.liveMetrics.totalReward + computedReward).toFixed(3));
    if (healthDelta < 0) genome.liveMetrics.damageTaken += Math.abs(healthDelta);

    if (metricUpdates && typeof metricUpdates === 'object') {
      for (const [k, v] of Object.entries(metricUpdates)) {
        if (k === 'maxStageReached') {
          genome.liveMetrics[k] = Math.max(genome.liveMetrics[k] || 1, Number(v) || 1);
        } else if (typeof v === 'number') {
          genome.liveMetrics[k] = (genome.liveMetrics[k] || 0) + v;
        }
      }
    }

    const rate = s.successes / Math.max(1, s.attempts);
    const rewardNorm = clamp((s.avgReward + 1) / 3, 0, 1);
    s.score = clamp(Number((s.score * 0.55 + (rate * 0.65 + rewardNorm * 0.35) * 0.45).toFixed(4)), 0, 1);

    // === ENGINE 1: REAL ONLINE ACTOR-CRITIC GRADIENT + PRIORITIZED REPLAY ===
    if (Array.isArray(stateVector) && stateVector.length === INPUT_SIZE && Array.isArray(actionParams)) {
      const lrScale = clamp(this.learningVelocity, 0.75, 2.2);
      const activeBrain = new ModularNeuralBrain(genome.arch);
      const advantage = activeBrain.applyActorCriticStep(
        skill,
        stateVector,
        actionParams,
        computedReward,
        0.04 * lrScale,
        0.05 * lrScale
      );
      genome.arch = activeBrain.toJSON();
      this._brainCache.delete(genome.id);

      // Collective Swarm Knowledge Transfer: also train champion on breakthrough experiences!
      if (this.bestOverall && this.bestOverall.id !== genome.id && (Math.abs(computedReward) >= 1.0 || success)) {
        const champBrain = new ModularNeuralBrain(this.bestOverall.arch);
        champBrain.applyActorCriticStep(
          skill,
          stateVector,
          actionParams,
          computedReward,
          0.025 * lrScale,
          0.035 * lrScale
        );
        this.bestOverall.arch = champBrain.toJSON();
        this._brainCache.delete(this.bestOverall.id);
      }

      const priority = Math.pow(Math.abs(advantage) + Math.abs(computedReward) * 0.5 + 0.1, 0.7);
      this.replayBuffer.push({
        skill,
        stateVector: stateVector.slice(),
        actionParams: actionParams.slice(0, HEAD_PARAMS),
        reward: computedReward,
        priority,
        timestamp: Date.now()
      });
      if (this.replayBuffer.length > 350) {
        this.replayBuffer.sort((a, b) => b.priority - a.priority);
        this.replayBuffer.length = 350;
      }

      // Mini-batch prioritized replay every 4 experiences for compounding convergence
      if (this.sharedExperienceCount % 4 === 0 && this.replayBuffer.length >= 6) {
        this.trainPrioritizedReplayBatch(this.bestOverall || genome, 6);
      }
    }

    const record = {
      timestamp: Date.now(),
      generation: this.generation,
      agentId: genome.id,
      agentSlot,
      mode: this.mode,
      skill,
      success: Boolean(success),
      reward: Number(computedReward.toFixed(3)),
      healthDelta,
      resourcesUsed,
      situation,
      actionParams,
      evidence
    };

    this.experiences.push(record);
    if (!success) {
      this.failureHistory.push(record);
      if (Array.isArray(stateVector) && stateVector.length === INPUT_SIZE) {
        this.environmentModel.replayScenarios.push({
          skill,
          stateVector,
          evidence: evidence || 'in_game_failure'
        });
      }
    } else {
      this.successfulStrategies.push({
        timestamp: record.timestamp,
        generation: this.generation,
        agentId: genome.id,
        skill,
        reward: record.reward,
        actionParams,
        situationSummary: situation
      });
    }

    if (this.experiences.length > 500) this.experiences.splice(0, this.experiences.length - 500);
    if (this.failureHistory.length > 300) this.failureHistory.splice(0, this.failureHistory.length - 300);
    if (this.successfulStrategies.length > 300) this.successfulStrategies.splice(0, this.successfulStrategies.length - 300);
    if (this.environmentModel.replayScenarios.length > 50) {
      this.environmentModel.replayScenarios.splice(0, this.environmentModel.replayScenarios.length - 50);
    }

    if (this.experiences.length % 8 === 0) {
      this.saveAll();
    }
  }

  trainPrioritizedReplayBatch(targetGenome, batchSize = 6) {
    if (!targetGenome || !this.replayBuffer.length) return;
    const brain = new ModularNeuralBrain(targetGenome.arch);
    const totalPriority = this.replayBuffer.reduce((s, r) => s + (r.priority || 0.2), 0) || 1;
    const lr = 0.02 * clamp(this.learningVelocity, 0.8, 2.0);

    for (let b = 0; b < Math.min(batchSize, this.replayBuffer.length); b++) {
      let r = Math.random() * totalPriority;
      let chosen = this.replayBuffer[0];
      for (const item of this.replayBuffer) {
        r -= (item.priority || 0.2);
        if (r <= 0) {
          chosen = item;
          break;
        }
      }
      brain.applyActorCriticStep(chosen.skill, chosen.stateVector, chosen.actionParams, chosen.reward, lr, lr * 1.2);
    }
    targetGenome.arch = brain.toJSON();
    this._brainCache.delete(targetGenome.id);
  }

  learnFromDeath(deathContext = {}, agentSlot = 0) {
    const {
      cause = 'unknown',
      attackerName = null,
      activeSkill = 'survival',
      stage = 1,
      goal = 'unknown',
      falling = false,
      creeperNearby = false,
      inLavaOrFire = false,
      food = 20,
      stateVector = null,
      skipImmediateEvolve = false
    } = deathContext;

    this.environmentModel.deathCount += 1;
    const adj = this.environmentModel.skillAdjustments;

    let evidence = 'unexpected_death';
    let targetSkill = SKILLS.includes(activeSkill) ? activeSkill : 'survival';

    if (falling || cause === 'fall') {
      evidence = 'died_from_fall_mlg_missed';
      targetSkill = 'mlg';
      adj.mlgTriggerBoost = clamp(adj.mlgTriggerBoost + 0.08, 0, 0.35);
    } else if (creeperNearby || attackerName === 'creeper' || cause === 'creeper') {
      evidence = 'died_to_creeper_explosion';
      targetSkill = 'defense';
      adj.creeperMarginBoost = clamp(adj.creeperMarginBoost + 1.0, 0, 4.0);
    } else if (inLavaOrFire || cause === 'lava' || cause === 'fire') {
      evidence = 'died_in_lava_or_fire';
      targetSkill = 'parkour';
      adj.stuckCautionBoost = clamp(adj.stuckCautionBoost + 0.08, 0, 0.35);
    } else if (attackerName) {
      evidence = `killed_by_${attackerName}_need_earlier_retreat_or_dodge`;
      targetSkill = 'pvp';
      adj.retreatBiasBoost = clamp(adj.retreatBiasBoost + 0.08, 0, 0.35);
      adj.dodgeBoost = clamp(adj.dodgeBoost + 0.07, 0, 0.35);
      if (!this.environmentModel.dangerProfiles[attackerName]) {
        this.environmentModel.dangerProfiles[attackerName] = { deaths: 0, hitsTaken: 0, threatScore: 0.4 };
      }
      this.environmentModel.dangerProfiles[attackerName].deaths += 1;
      this.environmentModel.dangerProfiles[attackerName].threatScore = clamp(
        this.environmentModel.dangerProfiles[attackerName].threatScore + 0.25,
        0.2,
        1.0
      );
    } else if (food <= 4 || cause === 'starve') {
      evidence = 'died_while_starving';
      targetSkill = 'survival';
    } else if (cause && cause !== 'unknown') {
      evidence = `died_${cause}`;
    }

    this.environmentModel.lastLesson = {
      generation: this.generation,
      evidence,
      targetSkill,
      attackerName,
      stage,
      goal,
      timestamp: new Date().toISOString()
    };

    const active = this.getGenomeForBot(agentSlot);
    if (!active.liveMetrics) active.liveMetrics = createEmptyLiveMetrics();
    active.liveMetrics.deaths += 1;

    // Expand mutation sigma specifically for the failing skill
    this.skillSigmas[targetSkill] = clamp((this.skillSigmas[targetSkill] || 0.2) * 1.18, 0.08, 0.45);

    this.recordExperience({
      skill: targetSkill,
      situation: { stage, goal, attackerName, falling, creeperNearby, inLavaOrFire, food, cause },
      actionParams: [adj.retreatBiasBoost, adj.dodgeBoost, adj.creeperMarginBoost / 4, adj.mlgTriggerBoost],
      success: false,
      reward: -2.4,
      healthDelta: -20,
      evidence,
      stateVector,
      agentSlot
    });

    let summary = null;
    if (!skipImmediateEvolve) {
      summary = this.evolveNextGeneration();
    }

    this.saveAll();

    return {
      evidence,
      targetSkill,
      lesson: this.environmentModel.lastLesson,
      summary
    };
  }

  // ========================================
  // MULTI-SKILL + LIVE EPISODIC EVALUATION
  // ========================================

  computeGenomeLiveScore(genome) {
    const m = genome.liveMetrics || createEmptyLiveMetrics();
    if ((m.attempts || 0) === 0) return null;
    const winRate = m.successes / Math.max(1, m.attempts);
    const avgReward = clamp((m.totalReward / Math.max(1, m.attempts) + 1) / 3, 0, 1);
    const progressionBonus = clamp((m.maxStageReached - 1) / 6, 0, 1);
    const combatBonus = clamp((m.critsLanded * 0.08 + m.kills * 0.12), 0, 0.35);
    const coopBonus = clamp(m.coopHelps * 0.06, 0, 0.25);
    const grindBonus = clamp((m.resourcesGathered * 0.02 + m.itemsCrafted * 0.05), 0, 0.35);
    const deathPenalty = Math.min(0.30, (m.deaths || 0) * 0.08);
    return clamp(
      winRate * 0.35 + avgReward * 0.25 + progressionBonus * 0.2 + combatBonus + coopBonus + grindBonus - deathPenalty,
      0,
      1
    );
  }

  evaluateGenomeAcrossSkills(genome, seedOffset = BENCHMARK_SEED) {
    const brain = new ModularNeuralBrain(genome.arch);

    const baseScores = {
      mlg: this.evalMLG(brain, seedOffset),
      pvp: this.evalPVP(brain, seedOffset),
      traps: this.evalTraps(brain, seedOffset),
      defense: this.evalDefense(brain, seedOffset),
      parkour: this.evalParkour(brain, seedOffset),
      building: this.evalBuilding(brain, seedOffset),
      survival: this.evalSurvival(brain, seedOffset),
      exploration: this.evalExploration(brain, seedOffset),
      cooperation: this.evalCooperation(brain, seedOffset)
    };

    const replayBonus = this.evaluateEnvironmentReplay(brain);

    for (const skill of SKILLS) {
      const personalAttempts = genome.skills[skill]?.attempts || 0;
      const personalRate = personalAttempts > 0 ? genome.skills[skill].successes / personalAttempts : null;
      const sharedStats = this.sharedSkillStats[skill];
      const sharedAttempts = sharedStats?.attempts || 0;
      const sharedRate = sharedAttempts > 0 ? sharedStats.successes / sharedAttempts : baseScores[skill];
      const rep = replayBonus[skill] !== undefined ? replayBonus[skill] : baseScores[skill];

      const simScore = baseScores[skill] * 0.65 + rep * 0.35;
      // Personal live attempts dominate this genome's skill evaluation when present!
      const personalWeight = clamp(personalAttempts / 8, 0, 0.72);
      const sharedWeight = clamp(sharedAttempts / 80, 0, 0.22);
      const simWeight = Math.max(0.15, 1 - personalWeight - sharedWeight);

      const combined =
        simScore * simWeight +
        (personalRate !== null ? personalRate : sharedRate) * personalWeight +
        sharedRate * sharedWeight;

      genome.skills[skill].score = Number(clamp(combined, 0, 1).toFixed(4));
      genome.skills[skill].lastEvaluatedGen = this.generation;
    }

    const vals = SKILLS.map(sk => genome.skills[sk].score);
    const meanScore = vals.reduce((a, b) => a + b, 0) / vals.length;
    const minScore = Math.min(...vals);
    const liveScore = this.computeGenomeLiveScore(genome);
    genome.liveFitness = liveScore !== null ? Number(liveScore.toFixed(4)) : 0;

    const deathPenalty = Math.min(0.16, (genome.liveMetrics?.deaths || 0) * 0.035);
    const baseFit = 0.58 * meanScore + 0.34 * minScore + 0.08 * (genome.diversityScore || 0);
    const blendedFit = liveScore !== null ? (baseFit * 0.55 + liveScore * 0.45) : baseFit;

    genome.overallScore = Number(meanScore.toFixed(4));
    genome.minSkillScore = Number(minScore.toFixed(4));
    genome.fitness = Number(clamp(blendedFit - deathPenalty, 0, 1).toFixed(4));

    return baseScores;
  }

  evaluateEnvironmentReplay(brain) {
    const scenarios = this.environmentModel.replayScenarios || [];
    if (!scenarios.length) return {};

    const sums = {};
    const counts = {};
    for (const sc of scenarios.slice(-24)) {
      const out = brain.decideSkill(sc.skill, sc.stateVector);
      let passScore = 0.5;
      if (sc.skill === 'pvp') passScore = clamp(out[1] * 0.45 + out[2] * 0.25 + out[3] * 0.3, 0, 1);
      else if (sc.skill === 'mlg') passScore = clamp(1 - Math.abs(out[0] - 0.55) * 1.4, 0, 1);
      else if (sc.skill === 'parkour') passScore = clamp(out[0] * 0.3 + out[1] * 0.3 + out[3] * 0.4, 0, 1);
      else passScore = clamp((out[0] + out[1] + out[2] + out[3]) / 4, 0, 1);

      sums[sc.skill] = (sums[sc.skill] || 0) + passScore;
      counts[sc.skill] = (counts[sc.skill] || 0) + 1;
    }

    const res = {};
    for (const sk of Object.keys(sums)) res[sk] = sums[sk] / counts[sk];
    return res;
  }

  evalMLG(brain, seedOffset) {
    let total = 0;
    const trials = 6;
    for (let t = 0; t < trials; t++) {
      let height = 10 + ((t * 7 + seedOffset) % 32);
      let vy = -0.05;
      let placed = false;
      let triggerHeight = 0;

      for (let tick = 0; tick < 80 && height > 0; tick++) {
        vy = (vy - 0.08) * 0.98;
        height += vy;
        const sv = new Array(INPUT_SIZE).fill(0);
        sv[0] = 1.0; sv[2] = clamp(vy / -3.0, 0, 1); sv[3] = clamp(height / 40, 0, 1); sv[8] = 1.0;
        const [triggerThresh, timingBias, lookPrecision] = brain.decideSkill('mlg', sv);
        const targetTrigger = 1.0 + triggerThresh * 5.0 + (timingBias - 0.5) * 1.5;

        if (!placed && height <= targetTrigger && height > 0.1) {
          placed = true;
          triggerHeight = height;
          total += (height <= 4.3 && lookPrecision >= 0.25) ? 1.0 - Math.abs(height - 2.3) * 0.12 : 0.15;
          break;
        }
      }
      if (placed && triggerHeight > 4.5) total += 0.1;
    }
    return clamp(total / trials, 0, 1);
  }

  evalPVP(brain, seedOffset) {
    let total = 0;
    const trials = 5;
    for (let t = 0; t < trials; t++) {
      let botHp = 20;
      let enemyHp = 20 + (t % 2) * 4;
      let dist = 6 - (t % 3);
      const enemyCount = t >= 3 ? 2 : 1;

      for (let step = 0; step < 25 && botHp > 0 && enemyHp > 0; step++) {
        const sv = new Array(INPUT_SIZE).fill(0);
        sv[0] = botHp / 20; sv[4] = clamp(dist / 16, 0, 1); sv[7] = clamp(enemyCount / 4, 0, 1);
        sv[9] = 1; sv[10] = 0.7; sv[11] = 0.6;
        const [aggression, dodgeTendency, critTiming, retreatBias] = brain.decideSkill('pvp', sv);

        if (botHp / 20 < retreatBias * 0.45) {
          dist += 2.0; botHp += 0.4;
        } else {
          if (dist > 2.8) dist -= 1.0 + aggression * 1.2;
          if (dist <= 3.2) {
            const critMult = critTiming > 0.45 ? 1.45 : 1.0;
            enemyHp -= (3.5 + aggression * 2.0) * critMult;
          }
          const dodgeMit = dodgeTendency > 0.4 ? 0.55 * dodgeTendency : 0;
          botHp -= Math.max(0.4, 2.8 * enemyCount * (1 - dodgeMit));
        }
      }
      if (enemyHp <= 0 && botHp > 0) total += 0.6 + 0.4 * (botHp / 20);
      else if (botHp > 0) total += 0.35 * (1 - clamp(enemyHp / 24, 0, 1));
    }
    return clamp(total / trials, 0, 1);
  }

  evalTraps(brain, seedOffset) {
    let total = 0;
    for (let t = 0; t < 4; t++) {
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[4] = 0.5; sv[14] = clamp((2 + ((t + seedOffset) % 4)) / 6, 0, 1); sv[15] = 0.4;
      const [placementDist, lurePatience, trapComplexity, selfAvoidance] = brain.decideSkill('traps', sv);
      const idealPlace = clamp(placementDist * 6, 1, 5);
      const p =
        (lurePatience > 0.35 ? 0.45 : 0.15) +
        (idealPlace >= 2 && idealPlace <= 4.5 ? 0.35 : 0.1) +
        (trapComplexity > 0.3 && trapComplexity < 0.85 ? 0.2 : 0.05) -
        (selfAvoidance < 0.35 ? 0.25 : 0);
      total += clamp(p, 0, 1);
    }
    return clamp(total / 4, 0, 1);
  }

  evalDefense(brain, seedOffset) {
    let total = 0;
    for (let t = 0; t < 4; t++) {
      const threat = 0.4 + ((t + seedOffset) % 3) * 0.25;
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[0] = 0.75; sv[4] = 0.35; sv[7] = threat; sv[9] = 1; sv[11] = 0.6;
      const [shieldReadiness, barricadeUrge, guardTether, escapeWeight] = brain.decideSkill('defense', sv);
      const blocked = shieldReadiness * 0.4 + barricadeUrge * 0.35 + guardTether * 0.25;
      total += clamp(blocked * (1.15 - threat * 0.3) - (escapeWeight > 0.85 ? 0.2 : 0), 0, 1);
    }
    return clamp(total / 4, 0, 1);
  }

  evalParkour(brain, seedOffset) {
    let total = 0;
    const gaps = [1.5, 2.2, 3.0, 2.5];
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[(i + seedOffset) % gaps.length];
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[14] = clamp(gap / 4, 0, 1); sv[15] = i === 2 ? 0.8 : 0.2;
      const [jumpTiming, sprintMomentum, lavaCaution, edgeControl] = brain.decideSkill('parkour', sv);
      const reach = 1.2 + sprintMomentum * 2.2 + edgeControl * 0.8;
      if (reach >= gap && jumpTiming >= 0.28) total += 0.75 + 0.25 * lavaCaution;
      else if (reach >= gap * 0.85) total += 0.35;
    }
    return clamp(total / gaps.length, 0, 1);
  }

  evalBuilding(brain, seedOffset) {
    let total = 0;
    const tasks = [3, 5, 8];
    for (let i = 0; i < tasks.length; i++) {
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[13] = 0.3; sv[14] = clamp(tasks[(i + seedOffset) % tasks.length] / 10, 0, 1);
      const [sneakSafety, placementCadence, materialEfficiency, wallHeightBias] = brain.decideSkill('building', sv);
      total += clamp(
        sneakSafety * 0.4 + (placementCadence > 0.28 && placementCadence < 0.88 ? 0.3 : 0.1) +
        materialEfficiency * 0.2 + (wallHeightBias >= 0.3 ? 0.1 : 0),
        0, 1
      );
    }
    return clamp(total / tasks.length, 0, 1);
  }

  evalSurvival(brain, seedOffset) {
    let total = 0;
    const scenarios = [
      { hp: 0.4, food: 0.2, night: 1, stage: 0.2 },
      { hp: 0.9, food: 0.6, night: 0, stage: 0.5 },
      { hp: 0.7, food: 0.3, night: 1, stage: 0.8 }
    ];
    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[(i + seedOffset) % scenarios.length];
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[0] = sc.hp; sv[1] = sc.food; sv[12] = sc.night; sv[16] = sc.stage;
      const [eatUrgency, gatherPriority, craftPriority, shelterCaution] = brain.decideSkill('survival', sv);
      let score = 0;
      if (sc.food < 0.4 && eatUrgency > 0.45) score += 0.4;
      else if (sc.food >= 0.4) score += 0.3;
      if (sc.night > 0.5 && shelterCaution > 0.45) score += 0.3;
      else if (sc.night < 0.5 && (gatherPriority > 0.4 || craftPriority > 0.4)) score += 0.35;
      score += 0.3 * clamp((gatherPriority + craftPriority) / 2, 0, 1);
      total += clamp(score, 0, 1);
    }
    return clamp(total / scenarios.length, 0, 1);
  }

  evalExploration(brain, seedOffset) {
    let total = 0;
    for (let t = 0; t < 3; t++) {
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[0] = 0.85; sv[15] = t === 1 ? 0.8 : 0.1; sv[17] = clamp(((t + 1 + seedOffset) % 4) / 4, 0, 1);
      const [curiosity, hazardAvoidance, baseTether, resourceFocus] = brain.decideSkill('exploration', sv);
      total += clamp(
        curiosity * 0.3 + hazardAvoidance * (t === 1 ? 0.4 : 0.2) +
        (baseTether > 0.25 && baseTether < 0.85 ? 0.2 : 0.05) + resourceFocus * 0.2,
        0, 1
      );
    }
    return clamp(total / 3, 0, 1);
  }

  evalCooperation(brain, seedOffset) {
    let total = 0;
    for (let t = 0; t < 3; t++) {
      const sv = new Array(INPUT_SIZE).fill(0);
      sv[0] = 0.85; sv[18] = clamp((t + 1 + seedOffset) % 4 / 5, 0.2, 1); sv[19] = 0.6;
      const [assistWillingness, shareGenerosity, combatBackup, roleDiscipline] = brain.decideSkill('cooperation', sv);
      total += clamp(
        assistWillingness * 0.3 + shareGenerosity * 0.25 + combatBackup * 0.25 + roleDiscipline * 0.2,
        0, 1
      );
    }
    return clamp(total / 3, 0, 1);
  }

  // ========================================
  // MODULAR SKILL-HEAD GRAFTING + OPENAI-ES
  // ========================================

  computeDiversityScores() {
    if (this.population.length < 2) return;
    const sampleLen = this.population[0].arch.trunkW.length;
    const mean = new Array(sampleLen).fill(0);
    for (const g of this.population) {
      for (let i = 0; i < sampleLen; i++) mean[i] += g.arch.trunkW[i] / this.population.length;
    }
    for (const g of this.population) {
      let dist = 0;
      for (let i = 0; i < sampleLen; i++) {
        const d = g.arch.trunkW[i] - mean[i];
        dist += d * d;
      }
      g.diversityScore = clamp(Math.sqrt(dist / sampleLen), 0, 1);
    }
  }

  tournamentSelect(k = 4) {
    let best = null;
    for (let i = 0; i < k; i++) {
      const candidate = this.population[Math.floor(Math.random() * this.population.length)];
      if (!best || candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }

  blendArrays(arrA, arrB, alpha = 0.5) {
    return arrA.map((v, idx) => clamp(v * alpha + arrB[idx] * (1 - alpha), -4.5, 4.5));
  }

  /**
   * Skill-Head Grafting Crossover:
   * Preserves complete neural skill heads instead of shattering hidden neurons!
   */
  crossover(parentA, parentB, childId) {
    const a = parentA.arch;
    const b = parentB.arch;
    const wRatio = parentA.fitness >= parentB.fitness ? 0.65 : 0.35;

    const childArch = {
      trunkW: this.blendArrays(a.trunkW, b.trunkW, wRatio),
      trunkB: this.blendArrays(a.trunkB, b.trunkB, wRatio),
      heads: {},
      criticW1: this.blendArrays(a.criticW1, b.criticW1, wRatio),
      criticB1: this.blendArrays(a.criticB1, b.criticB1, wRatio),
      criticW2: this.blendArrays(a.criticW2, b.criticW2, wRatio),
      criticB2: a.criticB2 * wRatio + b.criticB2 * (1 - wRatio)
    };

    for (const sk of SKILLS) {
      const scoreA = parentA.skills?.[sk]?.score || 0;
      const scoreB = parentB.skills?.[sk]?.score || 0;
      // Pick the stronger specialist head OR graft from skillChampions
      const winnerHead = scoreA >= scoreB ? a.heads[sk] : b.heads[sk];
      childArch.heads[sk] = {
        w: winnerHead.w.slice(),
        b: winnerHead.b.slice()
      };
    }

    return this.createGenome(childId, childArch, [parentA.id, parentB.id]);
  }

  mutate(genome, focusSkill = null) {
    const arch = genome.arch;
    const trunkSigma = this.mutationSigma * 0.45;

    for (let i = 0; i < arch.trunkW.length; i++) {
      if (Math.random() < this.mutationRate * 0.6) {
        arch.trunkW[i] = clamp(arch.trunkW[i] + gaussianRandom() * trunkSigma, -4.5, 4.5);
      }
    }

    for (const sk of SKILLS) {
      const sigma = (this.skillSigmas[sk] || this.mutationSigma) * (focusSkill === sk ? 1.35 : 0.9);
      const rate = focusSkill === sk ? Math.min(0.45, this.mutationRate * 1.5) : this.mutationRate;
      const h = arch.heads[sk];
      for (let i = 0; i < h.w.length; i++) {
        if (Math.random() < rate) {
          h.w[i] = clamp(h.w[i] + gaussianRandom() * sigma, -4.5, 4.5);
        }
      }
      for (let i = 0; i < h.b.length; i++) {
        if (Math.random() < rate) {
          h.b[i] = clamp(h.b[i] + gaussianRandom() * sigma * 0.6, -4.5, 4.5);
        }
      }
    }
    return genome;
  }

  evaluateGeneration(seedOffset = BENCHMARK_SEED) {
    this.computeDiversityScores();
    for (const genome of this.population) {
      this.evaluateGenomeAcrossSkills(genome, seedOffset);
    }

    this.population.sort((a, b) => b.fitness - a.fitness);

    const genBest = this.population[0];
    const prevBestFitness = this.bestOverall ? this.bestOverall.fitness : 0;

    if (!this.bestOverall || genBest.fitness >= this.bestOverall.fitness) {
      genBest.validated = true;
      this.bestOverall = JSON.parse(JSON.stringify(genBest));
      this.innovationHistory.push({
        generation: this.generation,
        agentId: genBest.id,
        fitness: genBest.fitness,
        overallScore: genBest.overallScore,
        minSkillScore: genBest.minSkillScore,
        timestamp: new Date().toISOString()
      });
    }

    for (const skill of SKILLS) {
      const bestForSkill = this.population.reduce((best, cur) =>
        cur.skills[skill].score > best.skills[skill].score ? cur : best
      );
      if (
        !this.skillChampions[skill] ||
        bestForSkill.skills[skill].score >= (this.skillChampions[skill].skills?.[skill]?.score || 0)
      ) {
        this.skillChampions[skill] = JSON.parse(JSON.stringify(bestForSkill));
      }
    }

    const avgFitness = this.population.reduce((s, g) => s + g.fitness, 0) / this.population.length;
    const prevGenRecord = this.generationHistory[this.generationHistory.length - 1];
    const prevGenFitness = prevGenRecord ? prevGenRecord.bestFitness : 0;
    const delta = genBest.fitness - prevGenFitness;

    // Exponential Adaptive Learning Velocity based on positive progression momentum
    if (delta > 0.002) {
      this.learningVelocity = clamp(this.learningVelocity * 1.12, 0.75, 2.25);
    } else if (delta < -0.01) {
      this.learningVelocity = clamp(this.learningVelocity * 0.94, 0.75, 2.25);
    }

    const summary = {
      generation: this.generation,
      populationSize: this.population.length,
      bestAgentId: genBest.id,
      bestFitness: Number(genBest.fitness.toFixed(4)),
      bestOverallScore: Number(genBest.overallScore.toFixed(4)),
      avgFitness: Number(avgFitness.toFixed(4)),
      previousGenBestFitness: Number(prevGenFitness.toFixed(4)),
      improvement: Number(delta.toFixed(4)),
      learningVelocity: Number(this.learningVelocity.toFixed(2)),
      championOverallFitness: Number((this.bestOverall?.fitness || prevBestFitness).toFixed(4)),
      skillScores: Object.fromEntries(
        SKILLS.map(sk => [sk, Number((genBest.skills[sk].score * 100).toFixed(1))])
      ),
      timestamp: new Date().toISOString()
    };

    this.generationHistory.push(summary);
    this.fitnessHistory.push({
      generation: this.generation,
      best: summary.bestFitness,
      avg: summary.avgFitness,
      champion: summary.championOverallFitness
    });
    if (this.generationHistory.length > 200) this.generationHistory.splice(0, this.generationHistory.length - 200);
    if (this.fitnessHistory.length > 200) this.fitnessHistory.splice(0, this.fitnessHistory.length - 200);
    if (this.innovationHistory.length > 200) this.innovationHistory.splice(0, this.innovationHistory.length - 200);

    this.saveAll();
    return summary;
  }

  evolveNextGeneration() {
    if (this.population.length === 0) this.initializePopulation();
    if (this.population.every(g => g.fitness === 0)) this.evaluateGeneration(BENCHMARK_SEED);

    // Train champion on top Prioritized Replay Buffer samples before breeding next gen!
    if (this.replayBuffer.length >= 6 && this.bestOverall) {
      this.trainPrioritizedReplayBatch(this.bestOverall, 12);
    }

    this.population.sort((a, b) => b.fitness - a.fitness);

    // Per-skill sigma adaptation (shrink sigma on strong skills, expand on weak skills)
    const top = this.population[0];
    for (const sk of SKILLS) {
      const sc = top.skills[sk]?.score || 0;
      if (sc > 0.72) this.skillSigmas[sk] = clamp((this.skillSigmas[sk] || 0.2) * 0.92, 0.06, 0.42);
      else if (sc < 0.48) this.skillSigmas[sk] = clamp((this.skillSigmas[sk] || 0.2) * 1.10, 0.08, 0.45);
    }

    const nextGenNumber = this.generation + 1;
    this.generation = nextGenNumber;

    const nextPop = [];
    const prefix = `GEN${String(nextGenNumber).padStart(3, '0')}`;

    // 1. Master Grafted Champion: grafts every skill's champion head onto bestOverall trunk!
    if (this.bestOverall) {
      const masterArch = JSON.parse(JSON.stringify(this.bestOverall.arch));
      for (const sk of SKILLS) {
        const spec = this.skillChampions[sk];
        if (spec?.arch?.heads?.[sk]) {
          masterArch.heads[sk] = JSON.parse(JSON.stringify(spec.arch.heads[sk]));
        }
      }
      const graftedChamp = this.createGenome(`${prefix}_GRAFTED_01`, masterArch, [this.bestOverall.id]);
      nextPop.push(graftedChamp);
    }

    // 2. Elitism
    for (let i = 0; i < Math.min(this.eliteCount - 1, this.population.length); i++) {
      const elite = JSON.parse(JSON.stringify(this.population[i]));
      elite.id = `${prefix}_ELITE_${String(i + 2).padStart(2, '0')}`;
      elite.generation = nextGenNumber;
      elite.liveMetrics = createEmptyLiveMetrics();
      nextPop.push(elite);
    }

    // 3. Antithetic (Mirrored) Exploration Pairs around Champion for OpenAI-ES variance reduction
    for (let sIdx = 0; sIdx < SKILLS.length && nextPop.length + 1 < this.populationSize; sIdx++) {
      const focus = SKILLS[sIdx];
      const base = this.bestOverall || this.population[0];
      const plus = this.createGenome(`${prefix}_ES_PLUS_${focus.toUpperCase()}`, JSON.parse(JSON.stringify(base.arch)), [base.id]);
      const minus = this.createGenome(`${prefix}_ES_MINUS_${focus.toUpperCase()}`, JSON.parse(JSON.stringify(base.arch)), [base.id]);
      const sigma = this.skillSigmas[focus] || 0.2;
      const headP = plus.arch.heads[focus];
      const headM = minus.arch.heads[focus];
      for (let i = 0; i < headP.w.length; i++) {
        const eps = gaussianRandom() * sigma;
        headP.w[i] = clamp(headP.w[i] + eps, -4.5, 4.5);
        headM.w[i] = clamp(headM.w[i] - eps, -4.5, 4.5);
      }
      nextPop.push(plus, minus);
    }

    // 4. Fill remaining slots via tournament crossover + focused mutation
    let idx = nextPop.length + 1;
    while (nextPop.length < this.populationSize) {
      const p1 = this.tournamentSelect(4);
      const p2 = this.tournamentSelect(4);
      const child = this.crossover(p1, p2, `${prefix}_AGENT_${String(idx++).padStart(2, '0')}`);
      const weakestSkill = SKILLS.reduce((a, b) =>
        (child.skills?.[a]?.score || 0) <= (child.skills?.[b]?.score || 0) ? a : b
      );
      this.mutate(child, weakestSkill);
      nextPop.push(child);
    }

    this.population = nextPop;
    this._brainCache.clear();
    return this.evaluateGeneration(BENCHMARK_SEED);
  }

  getLiveExperienceCount() {
    return this.sharedExperienceCount || 0;
  }

  runTrainingGenerations(count = 1) {
    let latest = null;
    for (let i = 0; i < count; i++) {
      if (this.generationHistory.length === 0) this.evaluateGeneration(BENCHMARK_SEED);
      latest = this.evolveNextGeneration();
    }
    return latest;
  }

  formatDashboard(summary = null, swarmCount = 1) {
    const latest = summary || this.generationHistory[this.generationHistory.length - 1];
    const champ = this.bestOverall || this.population[0];
    const skillsObj = latest ? latest.skillScores : Object.fromEntries(
      SKILLS.map(s => [s, Number(((champ?.skills?.[s]?.score || 0) * 100).toFixed(1))])
    );

    const bestPct = ((latest ? latest.bestOverallScore : champ.overallScore) * 100).toFixed(1);
    const prevPct = ((latest ? latest.previousGenBestFitness : 0) * 100).toFixed(1);
    const curFitPct = ((latest ? latest.bestFitness : champ.fitness) * 100).toFixed(1);
    const deltaPct = latest ? (latest.improvement * 100).toFixed(1) : '0.0';
    const sign = Number(deltaPct) >= 0 ? '+' : '';

    return [
      '========== E-HRL EXPONENTIAL EVOLUTION ==========',
      `Mode: ${this.mode} | Swarm Bots: ${swarmCount} | Gen: ${String(this.generation).padStart(3, '0')} | Learning Vel: ${this.learningVelocity.toFixed(2)}x`,
      `Population: ${this.population.length} | Live Outcomes: ${this.sharedExperienceCount} | Deaths Learned: ${this.environmentModel.deathCount}`,
      `Best Overall Score: ${bestPct}% (Fitness: ${curFitPct}%)`,
      'SKILL PERFORMANCE:',
      `  MLG:          ${skillsObj.mlg}%    | PVP (Crits): ${skillsObj.pvp}%`,
      `  TRAPS:        ${skillsObj.traps}%    | DEFENSE:     ${skillsObj.defense}%`,
      `  PARKOUR:      ${skillsObj.parkour}%    | BUILDING:    ${skillsObj.building}%`,
      `  SURVIVAL:     ${skillsObj.survival}%    | EXPLORATION: ${skillsObj.exploration}%`,
      `  COOPERATION:  ${skillsObj.cooperation}%`,
      `Best Agent: ${latest ? latest.bestAgentId : champ.id} | Prioritized Replay: ${this.replayBuffer.length}`,
      `Prev Gen Fitness: ${prevPct}% | Current: ${curFitPct}% (${sign}${deltaPct}%)`,
      `Milestones: ${Object.keys(this.milestoneUnlocked).join(', ') || 'None yet'}`,
      `Last Lesson: ${this.environmentModel.lastLesson ? this.environmentModel.lastLesson.evidence : 'None yet'}`,
      '=================================================='
    ].join('\n');
  }
}

module.exports = {
  EvolutionSystem,
  ModularNeuralBrain,
  SKILLS,
  MODES,
  INPUT_SIZE
};
const { Vec3 } = require('vec3');
const {
  Movements,
  goals: { GoalFollow, GoalNear, GoalXZ, GoalGetToBlock }
} = require('mineflayer-pathfinder');

const HOSTILE_MOBS = new Set([
  'zombie', 'zombie_villager', 'skeleton',
  'stray', 'bogged', 'spider', 'cave_spider',
  'drowned', 'husk', 'witch', 'enderman',
  'slime', 'magma_cube', 'phantom',
  'silverfish', 'endermite', 'pillager',
  'vindicator', 'evoker', 'ravager', 'vex',
  'blaze', 'ghast', 'wither_skeleton',
  'piglin_brute', 'hoglin', 'zoglin',
  'guardian', 'elder_guardian', 'breeze',
  'creaking', 'parched', 'camel_husk'
]);

const PASSIVE_FOOD_MOBS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit']);

const FOOD_ITEMS = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread',
  'baked_potato', 'apple', 'carrot', 'sweet_berries', 'melon_slice'
];

const RAW_MEAT_ITEMS = ['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon'];

const LOG_NAMES = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'pale_oak_log', 'crimson_stem', 'warped_stem'
];

const PICKAXE_NAMES = [
  'netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe',
  'copper_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'
];

const AXE_NAMES = [
  'netherite_axe', 'diamond_axe', 'iron_axe',
  'copper_axe', 'stone_axe', 'wooden_axe'
];

const SHOVEL_NAMES = [
  'netherite_shovel', 'diamond_shovel', 'iron_shovel',
  'copper_shovel', 'stone_shovel', 'wooden_shovel'
];

const SWORD_NAMES = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'copper_sword', 'stone_sword', 'wooden_sword'
];

const ARMOR_TIERS = ['netherite', 'diamond', 'iron', 'copper', 'golden', 'chainmail', 'leather'];

const ARMOR_SLOTS = [
  { suffix: '_helmet', slot: 'head', index: 5 },
  { suffix: '_chestplate', slot: 'torso', index: 6 },
  { suffix: '_leggings', slot: 'legs', index: 7 },
  { suffix: '_boots', slot: 'feet', index: 8 }
];

const CLUTCH_ITEMS = ['water_bucket', 'hay_block', 'slime_block', 'cobweb'];
const BUILD_BLOCKS = ['cobblestone', 'cobbled_deepslate', 'netherrack', 'dirt', 'oak_planks', 'spruce_planks', 'birch_planks'];

const SOFT_OBSTRUCTION_BLOCKS = new Set([
  'air', 'cave_air', 'void_air',
  'short_grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'pink_petals',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'pale_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
  'vine', 'snow', 'cobweb', 'torch', 'wall_torch', 'soul_torch'
]);

const PROTECTED_STRUCTURE_BLOCKS = [
  'chest', 'trapped_chest', 'ender_chest', 'barrel',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'smithing_table',
  'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil',
  'spawner', 'obsidian', 'nether_portal', 'bed',
  'white_bed', 'red_bed', 'blue_bed', 'green_bed',
  'yellow_bed', 'black_bed', 'brown_bed', 'orange_bed',
  'oak_door', 'iron_door', 'spruce_door', 'birch_door'
];

const HAZARD_BLOCKS = new Set([
  'lava', 'flowing_lava', 'fire', 'soul_fire',
  'cactus', 'sweet_berry_bush', 'magma_block'
]);

// Core semantic knowledge seed for items & blocks (augmented dynamically from mcData + real gameplay)
const BLOCK_KNOWLEDGE_SEED = {
  oak_log: { role: 'wood', bestTool: 'axe', minTier: 'hand', transformsTo: ['oak_planks', 'stick', 'crafting_table', 'charcoal'] },
  birch_log: { role: 'wood', bestTool: 'axe', minTier: 'hand', transformsTo: ['birch_planks', 'stick', 'crafting_table'] },
  spruce_log: { role: 'wood', bestTool: 'axe', minTier: 'hand', transformsTo: ['spruce_planks', 'stick', 'crafting_table'] },
  stone: { role: 'building_and_tools', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'cobblestone', transformsTo: ['stone_pickaxe', 'furnace'] },
  cobblestone: { role: 'building_and_tools', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'cobblestone', transformsTo: ['stone_pickaxe', 'furnace'] },
  coal_ore: { role: 'fuel_ore', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'coal', transformsTo: ['torch', 'furnace_fuel'] },
  deepslate_coal_ore: { role: 'fuel_ore', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'coal', transformsTo: ['torch', 'furnace_fuel'] },
  iron_ore: { role: 'metal_ore', bestTool: 'pickaxe', minTier: 'stone', expectedDrop: 'raw_iron', transformsTo: ['iron_ingot', 'iron_pickaxe', 'shield', 'bucket'] },
  deepslate_iron_ore: { role: 'metal_ore', bestTool: 'pickaxe', minTier: 'stone', expectedDrop: 'raw_iron', transformsTo: ['iron_ingot'] },
  gold_ore: { role: 'metal_ore', bestTool: 'pickaxe', minTier: 'iron', expectedDrop: 'raw_gold', transformsTo: ['gold_ingot', 'netherite_ingot'] },
  deepslate_gold_ore: { role: 'metal_ore', bestTool: 'pickaxe', minTier: 'iron', expectedDrop: 'raw_gold', transformsTo: ['gold_ingot', 'netherite_ingot'] },
  nether_gold_ore: { role: 'metal_ore', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'gold_nugget', transformsTo: ['gold_ingot'] },
  diamond_ore: { role: 'gem_ore', bestTool: 'pickaxe', minTier: 'iron', expectedDrop: 'diamond', transformsTo: ['diamond_pickaxe', 'diamond_armor'] },
  deepslate_diamond_ore: { role: 'gem_ore', bestTool: 'pickaxe', minTier: 'iron', expectedDrop: 'diamond', transformsTo: ['diamond_pickaxe', 'diamond_armor'] },
  obsidian: { role: 'portal_block', bestTool: 'pickaxe', minTier: 'diamond', expectedDrop: 'obsidian', transformsTo: ['nether_portal', 'enchanting_table'] },
  ancient_debris: { role: 'endgame_ore', bestTool: 'pickaxe', minTier: 'diamond', expectedDrop: 'ancient_debris', transformsTo: ['netherite_scrap', 'netherite_ingot', 'netherite_armor'] },
  gravel: { role: 'utility_gravity', bestTool: 'shovel', minTier: 'hand', gravityAffected: true, expectedDrop: 'gravel_or_flint', transformsTo: ['flint', 'flint_and_steel'] },
  sand: { role: 'building_gravity', bestTool: 'shovel', minTier: 'hand', gravityAffected: true, expectedDrop: 'sand', transformsTo: ['glass'] },
  netherrack: { role: 'nether_terrain', bestTool: 'pickaxe', minTier: 'wooden', expectedDrop: 'netherrack', hazardNote: 'Fast mine; watch for hidden lava pockets' },
  magma_block: { role: 'hazard_block', bestTool: 'pickaxe', minTier: 'wooden', hazardNote: 'Burns feet if stood on without sneaking' }
};

// Enforce axe-based knowledge for ALL log types (prevents pickaxe-from-pickaxe-slot contamination like dark_oak_log)
for (const logName of LOG_NAMES) {
  if (!BLOCK_KNOWLEDGE_SEED[logName]) {
    BLOCK_KNOWLEDGE_SEED[logName] = {
      role: 'wood',
      bestTool: 'axe',
      minTier: 'hand',
      transformsTo: [logName.replace('_log', '_planks').replace('_stem', '_planks'), 'stick', 'crafting_table']
    };
  }
}
BLOCK_KNOWLEDGE_SEED.dirt = { role: 'building', bestTool: 'shovel', minTier: 'hand', expectedDrop: 'dirt' };
BLOCK_KNOWLEDGE_SEED.grass_block = { role: 'building', bestTool: 'shovel', minTier: 'hand', expectedDrop: 'dirt' };

const ITEM_KNOWLEDGE_SEED = {
  coal: { category: 'fuel', smeltCapacity: 8, value: 3, uses: ['smelting', 'torches'] },
  charcoal: { category: 'fuel', smeltCapacity: 8, value: 3, uses: ['smelting', 'torches'] },
  raw_iron: { category: 'smeltable_ore', smeltsInto: 'iron_ingot', value: 5, uses: ['smelt_to_iron_ingot'] },
  raw_gold: { category: 'smeltable_ore', smeltsInto: 'gold_ingot', value: 5, uses: ['smelt_to_gold_ingot'] },
  ancient_debris: { category: 'smeltable_endgame', smeltsInto: 'netherite_scrap', value: 10, uses: ['smelt_to_netherite_scrap'] },
  netherite_scrap: { category: 'progression', craftsInto: 'netherite_ingot', value: 10, uses: ['craft_netherite_ingot_with_gold'] },
  netherite_ingot: { category: 'progression_endgame', value: 12, uses: ['upgrade_diamond_to_netherite_at_smithing_table'] },
  netherite_upgrade_smithing_template: { category: 'progression_template', value: 12, uses: ['smithing_slot_0_and_duplicate_with_7_diamonds'] },
  flint: { category: 'progression_utility', craftsInto: 'flint_and_steel', value: 4, uses: ['light_nether_portal'] },
  flint_and_steel: { category: 'portal_igniter', value: 6, uses: ['ignite_obsidian_nether_portal'] },
  water_bucket: { category: 'clutch_and_casting', value: 7, uses: ['mlg_fall_clutch', 'cast_lava_to_obsidian', 'extinguish_fire'] },
  obsidian: { category: 'portal_frame', value: 9, uses: ['build_4x5_nether_portal'] },
  diamond: { category: 'progression', value: 9, uses: ['diamond_pickaxe', 'diamond_sword', 'diamond_armor', 'duplicate_template'] },
  iron_ingot: { category: 'progression', value: 6, uses: ['iron_pickaxe', 'shield', 'bucket', 'flint_and_steel', 'smithing_table', 'iron_armor'] }
};

const TIER_ORDER = ['hand', 'wooden', 'stone', 'copper', 'iron', 'diamond', 'netherite'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label = 'op') {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function createSkillController({ bot, state, memory, saveMemory, evo, config, agentSlot = 0 }) {
  let mcData = null;
  let navMovements = null;
  let miningMovements = null;

  let guardUsername = null;
  let guardMode = null; // 'follow' | 'defend' | null
  let guardFallbackPos = null;
  let playerDefendTargetId = null;
  let playerDefendUntil = 0;
  let basePosition = null;
  let revengeTargetName = null;
  let revengeUntil = 0;
  let lastPlayerAttack = 0;
  const recentPlayerSwings = new Map();

  let lastDefenseDodge = 0;
  let dodgeRunning = false;
  let mlgActive = false;
  let lastMlgAttempt = 0;
  let lastParkourEvalAt = 0;
  let cachedCombatParams = [0.6, 0.5, 0.7, 0.4];
  let lastCombatEvalAt = 0;

  // Precision Critical-Hit Combat State
  let combatTarget = null;
  let lastMeleeAttackAt = 0;
  let critJumpTriggeredAt = 0;
  let shieldBlockingUntil = 0;
  let isShieldRaised = false;
  let lastCombatLookAt = 0;
  let respawnGraceUntil = 0;
  let activeCombatEncounter = null;

  // Persistent combat context for accurate death attribution
  let lastCombatTargetName = null;
  let lastCombatTimestamp = 0;
  let activeSkillContext = 'survival';

  // Auto-jump & Parkour State
  let lastAutoJumpAt = 0;
  let lastPhysicsGrounded = true;
  let activeParkourAttempt = null;

  // Cooldowns & Anti-stuck
  const activeTraps = [];
  const craftCooldowns = new Map();
  let lastHuntTime = 0;
  let lastResourceRequestAt = 0;
  let lastCombatHelpAt = 0;
  let lastProgressPos = null;
  let stuckTicks = 0;
  let unstuckAttempts = 0;
  let lastUnstuckTime = 0;
  let isActivelyDigging = false;
  let recoveringFromStuck = false;
  const failedBlockPositions = new Map();
  const failedColumns = new Map();

  let taskStateRef = {
    isInterrupted: () => false,
    isRunning: () => false,
    interrupt: async () => {}
  };

  function bindTaskHooks(hooks) {
    taskStateRef = hooks;
  }

  function log(msg) {
    console.log(`[SKILLS:${bot.username}]`, msg);
  }

  // Deduped control-state setter: avoids re-sending identical control packets every tick
  function setCtrl(name, val) {
    if (bot.controlState && bot.controlState[name] !== val) {
      bot.setControlState(name, val);
    }
  }

  /**
   * Fixes Mineflayer 1.21.11 / 26.1 server collision boundary bug (#3913):
   * prevents wall-gluing and step-up jitter on modern Paper/Vanilla servers.
   */
  function applyPhysicsWorkaround() {
    try {
      if (bot.physics && Math.abs((bot.physics.playerHalfWidth || 0) - 0.3) < 1e-6) {
        bot.physics.playerHalfWidth = 0.30000003;
        bot.physics.playerHeight = 1.80000018;
      }
    } catch {}
  }

  function setMcData(data) {
    mcData = data;
    initKnowledgeStore();
    configureSafeMovements();
  }

  // ========================================
  // BLOCK & ITEM KNOWLEDGE ENGINE
  // ========================================

  function ensureSwarmContext() {
    if (!config.swarmContext) config.swarmContext = {};
    if (!(config.swarmContext.claims instanceof Map)) config.swarmContext.claims = new Map();
    if (!Array.isArray(config.swarmContext.discoveries)) config.swarmContext.discoveries = [];
    if (!Array.isArray(config.swarmContext.requests)) config.swarmContext.requests = [];
    if (!config.swarmContext.stations) {
      config.swarmContext.stations = {
        crafting_table: null,
        furnace: null,
        chest: null,
        smithing_table: null,
        nether_portal: null
      };
    }
    if (!(config.swarmContext.roles instanceof Map)) config.swarmContext.roles = new Map();
    if (!config.swarmContext.teamAnchor) config.swarmContext.teamAnchor = null;
    if (!config.swarmContext.rallyUntil) config.swarmContext.rallyUntil = 0;
    if (!config.swarmContext.focusTargetId) config.swarmContext.focusTargetId = null;
    if (!config.swarmContext.guardedPlayerPos) config.swarmContext.guardedPlayerPos = null;
    if (!config.swarmContext.knowledge) config.swarmContext.knowledge = initKnowledgeStore();
    return config.swarmContext;
  }

  function initKnowledgeStore() {
    if (!memory.itemBlockKnowledge || typeof memory.itemBlockKnowledge !== 'object') {
      memory.itemBlockKnowledge = { blocks: {}, items: {}, observations: 0 };
    }
    if (!memory.itemBlockKnowledge.blocks) memory.itemBlockKnowledge.blocks = {};
    if (!memory.itemBlockKnowledge.items) memory.itemBlockKnowledge.items = {};
    if (typeof memory.itemBlockKnowledge.observations !== 'number') memory.itemBlockKnowledge.observations = 0;

    // Seed baseline semantic knowledge if missing
    for (const [bName, info] of Object.entries(BLOCK_KNOWLEDGE_SEED)) {
      if (!memory.itemBlockKnowledge.blocks[bName]) {
        memory.itemBlockKnowledge.blocks[bName] = {
          ...info,
          collections: 0,
          successfulYields: 0,
          emptyYields: 0,
          avgDigMs: null,
          observedDrops: {},
          hazardIncidents: 0
        };
      } else {
        // Always enforce true minimum harvest tier from seed (fixes stale 'wooden' lock on logs/dirt)
        memory.itemBlockKnowledge.blocks[bName].minTier = info.minTier;
        memory.itemBlockKnowledge.blocks[bName].bestTool = info.bestTool;
      }
    }
    for (const [iName, info] of Object.entries(ITEM_KNOWLEDGE_SEED)) {
      if (!memory.itemBlockKnowledge.items[iName]) {
        memory.itemBlockKnowledge.items[iName] = {
          ...info,
          timesCollected: 0
        };
      }
    }
    return memory.itemBlockKnowledge;
  }

  function getKnowledgeStore() {
    const sc = ensureSwarmContext();
    return sc.knowledge || initKnowledgeStore();
  }

  function getToolTierIndex(toolName) {
    if (!toolName) return 0; // 'hand'
    for (let i = 1; i < TIER_ORDER.length; i++) {
      if (toolName.startsWith(`${TIER_ORDER[i]}_`)) return i;
    }
    return 0;
  }

  function getBestCarriedTierForCategory(category) {
    const list = category === 'pickaxe' ? PICKAXE_NAMES
      : category === 'axe' ? AXE_NAMES
      : category === 'shovel' ? SHOVEL_NAMES
      : [];
    const best = getBestItem(list);
    return best ? getToolTierIndex(best.name) : 0;
  }

  /**
   * Understands a block's requirements, material, expected tool, and safety before collecting.
   */
  function inspectBlockKnowledge(block) {
    if (!block) return null;
    const kb = getKnowledgeStore();
    const mcBlock = mcData?.blocksByName?.[block.name];
    const seed = BLOCK_KNOWLEDGE_SEED[block.name] || {};
    const learned = kb.blocks[block.name] || {};

    let bestToolCategory = learned.bestTool || seed.bestTool || 'hand';
    if (!learned.bestTool && !seed.bestTool && mcBlock?.material) {
      const mat = String(mcBlock.material).toLowerCase();
      if (mat.includes('rock') || mat.includes('stone') || mat.includes('iron') || mat.includes('metal')) bestToolCategory = 'pickaxe';
      else if (mat.includes('wood') || mat.includes('log') || mat.includes('plank')) bestToolCategory = 'axe';
      else if (mat.includes('dirt') || mat.includes('sand') || mat.includes('ground') || mat.includes('snow')) bestToolCategory = 'shovel';
    }
    if (block.name.endsWith('_log') || block.name.endsWith('_stem') || block.name.endsWith('_planks')) bestToolCategory = 'axe';
    if (block.name.includes('ore') || block.name.includes('stone') || block.name === 'obsidian' || block.name === 'ancient_debris' || block.name === 'netherrack') {
      bestToolCategory = 'pickaxe';
    }

    const minTierName = learned.minTier || seed.minTier || 'hand';
    const minTierIdx = Math.max(0, TIER_ORDER.indexOf(minTierName));

    // Verify using mcData.harvestTools when available
    let harvestableWithCurrent = true;
    const toolPool = bestToolCategory === 'pickaxe' ? PICKAXE_NAMES
      : bestToolCategory === 'axe' ? AXE_NAMES
      : bestToolCategory === 'shovel' ? SHOVEL_NAMES
      : [];
    const bestToolItem = getBestItem(toolPool);
    const carriedTierIdx = getBestCarriedTierForCategory(bestToolCategory);

    if (carriedTierIdx < minTierIdx) {
      harvestableWithCurrent = false;
    } else if (mcBlock?.harvestTools && Object.keys(mcBlock.harvestTools).length > 0) {
      // Check if ANY item we own is in mcBlock.harvestTools
      const owned = getAllInventoryItems();
      const canWithAnyOwned = owned.some(i => Boolean(mcBlock.harvestTools[String(i.type)]));
      if (!canWithAnyOwned) harvestableWithCurrent = false;
    }

    return {
      name: block.name,
      role: learned.role || seed.role || 'terrain',
      bestToolCategory,
      bestToolItem,
      minTierName,
      harvestableWithCurrent,
      hardness: mcBlock?.hardness ?? 1.5,
      gravityAffected: Boolean(learned.gravityAffected || seed.gravityAffected || ['sand', 'red_sand', 'gravel'].includes(block.name)),
      observedDrops: learned.observedDrops || {},
      transformsTo: learned.transformsTo || seed.transformsTo || []
    };
  }

  /**
   * Chooses and equips the smartest tool for any block before collecting it.
   */
  async function equipBestToolForBlock(block) {
    if (!block) return null;
    const info = inspectBlockKnowledge(block);
    if (!info) return null;
    if (info.bestToolItem && bot.heldItem?.name !== info.bestToolItem.name) {
      try { await bot.equip(info.bestToolItem, 'hand'); } catch {}
    }
    return info;
  }

  /**
   * Snapshots inventory before/after collecting a block so the bot genuinely learns
   * what items drop from which block, how fast tools dig it, and whether it yielded drops!
   */
  function snapshotInventoryCounts() {
    const map = {};
    for (const item of getAllInventoryItems()) {
      map[item.name] = (map[item.name] || 0) + item.count;
    }
    return map;
  }

  function classifyDiscoveredItem(itemName) {
    const kb = getKnowledgeStore();
    if (kb.items[itemName]) return kb.items[itemName];
    let category = 'misc';
    const uses = [];
    if (mcData?.foodsByName?.[itemName]) {
      category = 'food';
      uses.push(`restores_${mcData.foodsByName[itemName].foodPoints}_hunger`);
    } else if (BUILD_BLOCKS.includes(itemName) || itemName.endsWith('_planks')) {
      category = 'building';
      uses.push('bridging_shelter_pillaring');
    } else if (LOG_NAMES.includes(itemName)) {
      category = 'wood_log';
      uses.push('craft_planks_sticks_crafting_table');
    } else if (PICKAXE_NAMES.includes(itemName) || AXE_NAMES.includes(itemName) || SHOVEL_NAMES.includes(itemName) || SWORD_NAMES.includes(itemName)) {
      category = 'tool_or_weapon';
    }
    kb.items[itemName] = { category, uses, timesCollected: 0, value: 2 };
    return kb.items[itemName];
  }

  function learnFromBlockCollection({ blockName, usedToolName, digTimeMs, beforeInv, afterInv, hpDelta }) {
    if (!blockName) return;
    const kb = getKnowledgeStore();
    kb.observations += 1;

    if (!kb.blocks[blockName]) {
      const seed = BLOCK_KNOWLEDGE_SEED[blockName] || {};
      kb.blocks[blockName] = {
        role: seed.role || 'learned_block',
        bestTool: seed.bestTool || (usedToolName?.includes('axe') ? 'axe' : usedToolName?.includes('shovel') ? 'shovel' : 'pickaxe'),
        minTier: seed.minTier || 'hand',
        transformsTo: seed.transformsTo || [],
        collections: 0,
        successfulYields: 0,
        emptyYields: 0,
        avgDigMs: null,
        observedDrops: {},
        hazardIncidents: 0
      };
    }

    const entry = kb.blocks[blockName];
    const isFirstDiscovery = entry.collections === 0;
    entry.collections += 1;
    entry.avgDigMs = entry.avgDigMs === null ? digTimeMs : Math.round(entry.avgDigMs * 0.75 + digTimeMs * 0.25);
    if (hpDelta < 0) entry.hazardIncidents += 1;

    let totalGained = 0;
    const gainedItems = [];
    for (const [itemName, afterCount] of Object.entries(afterInv)) {
      const delta = afterCount - (beforeInv[itemName] || 0);
      if (delta > 0) {
        totalGained += delta;
        gainedItems.push(`${itemName}x${delta}`);
        entry.observedDrops[itemName] = (entry.observedDrops[itemName] || 0) + delta;

        const itemEntry = classifyDiscoveredItem(itemName);
        itemEntry.timesCollected = (itemEntry.timesCollected || 0) + delta;
        itemEntry.lastSeenFrom = blockName;
      }
    }

    if (totalGained > 0) {
      entry.successfulYields += 1;
    } else {
      entry.emptyYields += 1;
      const mcBlock = mcData?.blocksByName?.[blockName];
      const seedMinTier = BLOCK_KNOWLEDGE_SEED[blockName]?.minTier;
      const canTrulyRequireTool =
        seedMinTier !== 'hand' &&
        mcBlock?.harvestTools &&
        Object.keys(mcBlock.harvestTools).length > 0;

      const tierUsedIdx = getToolTierIndex(usedToolName);
      if (
        canTrulyRequireTool &&
        entry.emptyYields >= 2 &&
        entry.successfulYields === 0 &&
        tierUsedIdx < TIER_ORDER.length - 1
      ) {
        entry.minTier = TIER_ORDER[tierUsedIdx + 1];
        log(`[KNOWLEDGE] Learned ${blockName} requires ${entry.minTier} tier.`);
      }
    }

    if (isFirstDiscovery && totalGained > 0) {
      log(`[KNOWLEDGE] Learned new block '${blockName}' -> drops [${gainedItems.join(', ')}] in ${digTimeMs}ms`);
      evo.recordExperience({
        skill: 'survival',
        situation: { task: 'learn_block_item', block: blockName, drops: gainedItems },
        actionParams: [0.5, 0.8, 0.7, 0.5],
        success: true,
        reward: 1.2,
        evidence: `learned_${blockName}_drops_${gainedItems[0] || 'none'}`,
        stateVector: buildStateVector(),
        agentSlot
      });
    }

    if (kb.observations % 5 === 0) saveMemory();
  }

  function chooseSmartFood(hp, foodLevel) {
    const missingFood = 20 - (foodLevel || 20);
    if (hp <= 12) {
      const gapple = getBestItem(['golden_apple', 'enchanted_golden_apple']);
      if (gapple) return gapple;
    }

    const available = FOOD_ITEMS
      .map(name => ({ name, item: getBestItem([name]), info: mcData?.foodsByName?.[name] }))
      .filter(x => x.item);

    if (!available.length) {
      return foodLevel <= 6 ? getBestItem(RAW_MEAT_ITEMS) : null;
    }

    // If missing a lot of hunger or hurt, pick highest foodPoints/saturation; otherwise don't waste prime steak on 2 hunger!
    available.sort((a, b) => {
      const fa = a.info?.foodPoints || 4;
      const fb = b.info?.foodPoints || 4;
      if (missingFood <= 4 && hp > 16) return fa - fb;
      return fb - fa;
    });
    return available[0].item;
  }

  function chooseSmartFuel(itemsToSmeltCount = 1) {
    // Prefer coal/charcoal for batches >= 3; planks/logs for tiny 1-2 item smelts when short on coal
    if (itemsToSmeltCount >= 3 || inventoryCount('coal') + inventoryCount('charcoal') >= 2) {
      return getBestItem([
        'coal', 'charcoal', 'oak_planks', 'birch_planks', 'spruce_planks',
        'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'oak_log', 'birch_log'
      ]);
    }
    return getBestItem([
      'oak_planks', 'birch_planks', 'spruce_planks', 'coal', 'charcoal', 'oak_log', 'birch_log'
    ]);
  }

  function getKnowledgeSummaryText(query = null) {
    const kb = getKnowledgeStore();
    if (query) {
      const q = query.toLowerCase().trim();
      if (kb.blocks[q]) {
        const b = kb.blocks[q];
        const drops = Object.entries(b.observedDrops || {}).map(([k, v]) => `${k}(${v})`).join(', ') || b.expectedDrop || 'unknown';
        return `Block[${q}]: tool=${b.bestTool}(min:${b.minTier}), drops=[${drops}], yields=${b.successfulYields}/${b.collections}, avg=${b.avgDigMs || '?'}ms`;
      }
      if (kb.items[q]) {
        const i = kb.items[q];
        return `Item[${q}]: category=${i.category}, uses=[${(i.uses || []).join(',')}], collected=${i.timesCollected || 0}`;
      }
      const mcB = mcData?.blocksByName?.[q];
      if (mcB) {
        return `Block[${q}](mcData): hardness=${mcB.hardness}, material=${mcB.material || 'none'}, diggable=${mcB.diggable}`;
      }
      return `No knowledge entry yet for '${q}'.`;
    }
    const knownBlocks = Object.values(kb.blocks).filter(b => b.collections > 0).length;
    const knownItems = Object.values(kb.items).filter(i => (i.timesCollected || 0) > 0).length;
    return `Knowledge: ${kb.observations} observations | ${knownBlocks} blocks & ${knownItems} items empirically profiled`;
  }

  // ========================================
  // MOVEMENT CONFIGURATION
  // ========================================

  function configureSafeMovements() {
    if (!mcData) return;

    bot.pathfinder.thinkTimeout = 1200;
    bot.pathfinder.tickTimeout = 35;

    const nav = new Movements(bot);
    nav.canDig = false;
    nav.allowParkour = true;
    nav.allow1by1towers = false;
    nav.allowSprinting = true;
    nav.canOpenDoors = true;
    nav.maxDropDown = 3;
    nav.dontCreateFlow = true;
    nav.dontMineUnderFallingBlock = true;
    nav.scafoldingBlocks = [];

    const mine = new Movements(bot);
    mine.canDig = true;
    mine.allowParkour = true;
    mine.allow1by1towers = false;
    mine.allowSprinting = true;
    mine.canOpenDoors = true;
    mine.maxDropDown = 3;
    mine.dontCreateFlow = true;
    mine.dontMineUnderFallingBlock = true;

    for (const blockName of PROTECTED_STRUCTURE_BLOCKS) {
      const id = mcData.blocksByName[blockName]?.id;
      if (id !== undefined) {
        nav.blocksCantBreak.add(id);
        mine.blocksCantBreak.add(id);
      }
    }

    for (const bName of BUILD_BLOCKS) {
      const id = mcData.itemsByName[bName]?.id;
      if (id !== undefined) mine.scafoldingBlocks.push(id);
    }

    navMovements = nav;
    miningMovements = mine;
    bot.pathfinder.setMovements(navMovements);
    if (bot.collectBlock) bot.collectBlock.movements = navMovements;
  }

  function useNavigationMovements() {
    if (bot.pathfinder && navMovements) bot.pathfinder.setMovements(navMovements);
    if (bot.collectBlock && navMovements) bot.collectBlock.movements = navMovements;
  }

  function useMiningMovements() {
    if (bot.pathfinder && miningMovements) bot.pathfinder.setMovements(miningMovements);
    if (bot.collectBlock && miningMovements) bot.collectBlock.movements = miningMovements;
  }

  function setGoal(goal, dynamic = false) {
    if (bot.pathfinder && bot.entity) bot.pathfinder.setGoal(goal, dynamic);
  }

  function clearMovement() {
    try { bot.clearControlStates(); } catch {}
    try { bot.deactivateItem(); } catch {}
    try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {}
    setGoal(null);
    useNavigationMovements();
  }

  // ========================================
  // ENTITY & INVENTORY HELPERS
  // ========================================

  function isHostileEntity(e) {
    if (!e || !e.name) return false;
    if (e.isValid === false) return false;
    if (['player', 'object', 'orb', 'global', 'other'].includes(e.type)) return false;
    if (e.name === 'creeper' || e.name === 'armor_stand') return false;
    return HOSTILE_MOBS.has(e.name) || e.type === 'hostile';
  }

  function isCreeperEntity(e) {
    return Boolean(e && e.isValid !== false && e.name === 'creeper');
  }

  function isPassiveFoodEntity(e) {
    if (!e || !e.name || e.isValid === false) return false;
    if (e.type === 'player' || e.type === 'object') return false;
    return PASSIVE_FOOD_MOBS.has(e.name);
  }

  function isDroppedItemEntity(e) {
    if (!e || e.isValid === false) return false;
    return e.name === 'item' || e.displayName === 'Item' || e.type === 'item';
  }

  function findNearestDrop(maxDist = 10) {
    if (!bot.entity) return null;
    return bot.nearestEntity(e =>
      isDroppedItemEntity(e) &&
      e.position.distanceTo(bot.entity.position) <= maxDist
    );
  }

  function normalizePlayerName(value) {
    let name = String(value || '').trim();
    const configuredPrefix = String(config.bedrockUsernamePrefix || '.');
    const prefixes = [...new Set([configuredPrefix, '.', '*'].filter(Boolean))];
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        break;
      }
    }
    return name.toLowerCase();
  }

  function findPlayerEntity(username) {
    if (!username || !bot.entity) return null;
    const requested = String(username).trim();
    const requestedLower = requested.toLowerCase();

    if (bot.players[requested]?.entity) return bot.players[requested].entity;
    for (const [key, info] of Object.entries(bot.players || {})) {
      const entity = info?.entity;
      if (!entity || entity.isValid === false) continue;
      if (
        key.toLowerCase() === requestedLower ||
        String(info.username || '').toLowerCase() === requestedLower ||
        String(entity.username || '').toLowerCase() === requestedLower
      ) return entity;
    }

    const wanted = normalizePlayerName(requested);
    const matches = new Map();
    for (const [key, info] of Object.entries(bot.players || {})) {
      const entity = info?.entity;
      if (!entity || entity.isValid === false) continue;
      const aliases = [key, info.username, entity.username]
        .filter(Boolean)
        .map(normalizePlayerName);
      if (aliases.includes(wanted)) matches.set(entity.id, entity);
    }
    for (const entity of Object.values(bot.entities || {})) {
      if (entity?.type !== 'player' || entity.isValid === false) continue;
      if (normalizePlayerName(entity.username) === wanted) matches.set(entity.id, entity);
    }

    if (matches.size === 1) return [...matches.values()][0];
    return null;
  }

  function getAllInventoryItems() {
    const seen = new Set();
    const list = [];
    for (const item of bot.inventory.items()) {
      // Exclude 2x2 crafting grid slots (0..4) so temporary craft items are never counted as owned
      if (item && item.slot >= 5 && !seen.has(item.slot)) {
        seen.add(item.slot);
        list.push(item);
      }
    }
    for (const item of bot.inventory.slots) {
      // Exclude 2x2 crafting grid slots (0..4) so temporary craft items are never counted as owned
      if (item && item.slot >= 5 && !seen.has(item.slot)) {
        seen.add(item.slot);
        list.push(item);
      }
    }
    return list;
  }

  function inventoryCount(name) {
    return getAllInventoryItems()
      .filter(i => i.name === name)
      .reduce((sum, i) => sum + i.count, 0);
  }

  function countMatchingItems(pred) {
    return getAllInventoryItems()
      .filter(pred)
      .reduce((sum, i) => sum + i.count, 0);
  }

  function getInventorySummaryText() {
    const counts = {};
    for (const item of getAllInventoryItems()) {
      counts[item.name] = (counts[item.name] || 0) + item.count;
    }
    const entries = Object.entries(counts);
    if (!entries.length) return 'empty';
    return entries.map(([n, c]) => `${n} x${c}`).join(', ');
  }

  function getTotalWoodLogs() {
    return LOG_NAMES.reduce((sum, n) => sum + inventoryCount(n), 0);
  }

  function getTotalPlanks() {
    return countMatchingItems(i => i.name.endsWith('_planks'));
  }

  function getMaxSinglePlankCount() {
    const counts = {};
    for (const item of getAllInventoryItems()) {
      if (item.name.endsWith('_planks')) {
        counts[item.name] = (counts[item.name] || 0) + item.count;
      }
    }
    return Math.max(0, ...Object.values(counts));
  }

  let lastTableScanAt = 0;
  let cachedTableReady = false;
  let lastFurnaceScanAt = 0;
  let cachedFurnaceReady = false;

  function hasCraftingTableReady() {
    if (!mcData || !bot.entity) return false;
    if (inventoryCount('crafting_table') > 0 || ensureSwarmContext().stations.crafting_table) return true;
    const now = Date.now();
    if (now - lastTableScanAt < 4000) return cachedTableReady;
    lastTableScanAt = now;
    const ctId = mcData.blocksByName.crafting_table?.id;
    cachedTableReady = Boolean(ctId !== undefined && bot.findBlock({ matching: ctId, maxDistance: 16 }));
    return cachedTableReady;
  }

  function hasFurnaceOrMaterials() {
    if (!mcData || !bot.entity) return false;
    if (inventoryCount('furnace') > 0 || inventoryCount('cobblestone') >= 8 || ensureSwarmContext().stations.furnace) return true;
    const now = Date.now();
    if (now - lastFurnaceScanAt < 4000) return cachedFurnaceReady;
    lastFurnaceScanAt = now;
    const fId = mcData.blocksByName.furnace?.id;
    cachedFurnaceReady = Boolean(fId !== undefined && bot.findBlock({ matching: fId, maxDistance: 16 }));
    return cachedFurnaceReady;
  }

  function getTotalEdibleFood() {
    return FOOD_ITEMS.reduce((sum, n) => sum + inventoryCount(n), 0);
  }

  function getTotalRawMeat() {
    return RAW_MEAT_ITEMS.reduce((sum, n) => sum + inventoryCount(n), 0);
  }

  function getBestItem(names) {
    const items = getAllInventoryItems();
    for (const name of names) {
      const item = items.find(i => i.name === name);
      if (item) return item;
    }
    return null;
  }

  function hasToolTierOrBetter(names, minTierName) {
    const minIdx = names.indexOf(minTierName);
    if (minIdx === -1) return false;
    for (let i = 0; i <= minIdx; i++) {
      if (inventoryCount(names[i]) > 0) return true;
    }
    return false;
  }

  function getNetheriteArmorCount() {
    let c = 0;
    for (const s of ARMOR_SLOTS) {
      const equipped = bot.inventory.slots[s.index];
      const name = `netherite${s.suffix}`;
      if (equipped?.name === name || inventoryCount(name) > 0) c++;
    }
    return c;
  }

  function isSwarmBotName(username) {
    if (!username) return false;
    return normalizePlayerName(username).startsWith(normalizePlayerName(config.botPrefix));
  }

  function isFriendly(username) {
    if (!username) return false;
    const normalized = normalizePlayerName(username);
    if (normalized.startsWith(normalizePlayerName(config.botPrefix))) return true;
    return config.friendlyPlayers.some(n => normalizePlayerName(n) === normalized);
  }

  function isProtectedPlayer(username) {
    if (!username) return true;
    if (normalizePlayerName(username) === normalizePlayerName(bot.username)) return true;
    if (isFriendly(username)) return true;
    if (config.ownerUsername && normalizePlayerName(username) === normalizePlayerName(config.ownerUsername)) return true;
    return false;
  }

  function posKey(pos) {
    if (!pos || pos.x === undefined) return '0,0,0';
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  function colKey(pos) {
    if (!pos || pos.x === undefined) return '0,0';
    return `${Math.floor(pos.x)},${Math.floor(pos.z)}`;
  }

  function blacklistBlockPos(pos, durationMs = 35000) {
    if (!pos || pos.x === undefined) return;
    failedBlockPositions.set(posKey(pos), Date.now() + durationMs);
  }

  function blacklistColumn(pos, durationMs = 45000) {
    if (!pos || pos.x === undefined) return;
    failedColumns.set(colKey(pos), Date.now() + durationMs);
  }

  function isBlockBlacklisted(pos) {
    if (!pos || pos.x === undefined) return false;
    const now = Date.now();
    const bUntil = failedBlockPositions.get(posKey(pos));
    if (bUntil) {
      if (now <= bUntil) return true;
      failedBlockPositions.delete(posKey(pos));
    }
    const cUntil = failedColumns.get(colKey(pos));
    if (cUntil) {
      if (now <= cUntil) return true;
      failedColumns.delete(colKey(pos));
    }
    return false;
  }

  function nearestHostile(maxDistance = 12, fromPos = null) {
    if (!bot.entity) return null;
    const origin = fromPos || bot.entity.position;
    let closest = null;
    let closestDist = Infinity;

    for (const e of Object.values(bot.entities)) {
      if (!isHostileEntity(e)) continue;
      const dist = e.position.distanceTo(origin);
      if (dist <= maxDistance && dist < closestDist) {
        closest = e;
        closestDist = dist;
      }
    }
    return closest;
  }

  function nearestCreeper(maxDistance = 7) {
    if (!bot.entity) return null;
    let closest = null;
    let closestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (!isCreeperEntity(e)) continue;
      const dist = e.position.distanceTo(bot.entity.position);
      if (dist <= maxDistance && dist < closestDist) {
        closest = e;
        closestDist = dist;
      }
    }
    return closest;
  }

  function countNearbyHostiles(maxDistance = 12) {
    if (!bot.entity) return 0;
    let count = 0;
    for (const e of Object.values(bot.entities)) {
      if (isHostileEntity(e) && e.position.distanceTo(bot.entity.position) <= maxDistance) count++;
    }
    return count;
  }

  function countNearbyTeammates(maxDistance = 32) {
    if (!bot.entity) return 0;
    let count = 0;
    for (const e of Object.values(bot.entities)) {
      if (
        e?.type === 'player' &&
        e.isValid !== false &&
        e.username !== bot.username &&
        isSwarmBotName(e.username) &&
        e.position.distanceTo(bot.entity.position) <= maxDistance
      ) {
        count++;
      }
    }
    return count;
  }

  function isBlockPassable(block) {
    if (!block) return false;
    return block.boundingBox === 'empty' || SOFT_OBSTRUCTION_BLOCKS.has(block.name);
  }

  function isBlockSolidFloor(block) {
    if (!block) return false;
    return block.boundingBox !== 'empty' && !HAZARD_BLOCKS.has(block.name) && block.name !== 'water' && block.name !== 'flowing_water';
  }

  function isBlockExposed(block) {
    if (!block) return false;
    const dirs = [
      new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];
    for (const d of dirs) {
      const n = bot.blockAt(block.position.plus(d));
      if (n && (n.name === 'air' || n.name === 'cave_air' || SOFT_OBSTRUCTION_BLOCKS.has(n.name))) {
        return true;
      }
    }
    return false;
  }

  function rememberSharedDiscovery(block) {
    const sc = ensureSwarmContext();
    if (!block?.position || !block.name) return;
    const key = `${block.name}:${posKey(block.position)}`;
    const existing = sc.discoveries.find(d => d.key === key);
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.lastSeenBy = bot.username;
      return;
    }
    sc.discoveries.push({
      key,
      name: block.name,
      x: Math.floor(block.position.x),
      y: Math.floor(block.position.y),
      z: Math.floor(block.position.z),
      discoveredBy: bot.username,
      discoveredAt: Date.now(),
      lastSeenAt: Date.now(),
      lastSeenBy: bot.username
    });
    if (sc.discoveries.length > 300) sc.discoveries.splice(0, sc.discoveries.length - 300);
  }

  function registerSharedStation(type, pos) {
    if (!pos) return;
    const sc = ensureSwarmContext();
    sc.stations[type] = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), owner: bot.username, at: Date.now() };
    if (type === 'nether_portal') {
      memory.portalPosition = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      saveMemory();
    }
  }

  function claimResourcePosition(pos, ttlMs = 30000) {
    const sc = ensureSwarmContext();
    if (!pos) return () => {};
    const key = posKey(pos);
    const now = Date.now();
    const existing = sc.claims.get(key);
    if (existing && existing.expiresAt > now && existing.owner !== bot.username) return null;
    sc.claims.set(key, { owner: bot.username, expiresAt: now + ttlMs });
    return () => {
      const current = sc.claims.get(key);
      if (current?.owner === bot.username) sc.claims.delete(key);
    };
  }

  function findBlockByNames(names, maxDistance = 28, preferSameLevel = false, requireExposed = false) {
    if (!mcData || !bot.entity) return null;
    const ids = names.map(n => mcData.blocksByName[n]?.id).filter(id => id !== undefined);
    if (!ids.length) return null;

    const positions = bot.findBlocks({ matching: ids, maxDistance, count: 48 });
    const sc = ensureSwarmContext();
    for (const item of sc.discoveries) {
      if (!names.includes(item.name)) continue;
      const pos = new Vec3(item.x, item.y, item.z);
      if (pos.distanceTo(bot.entity.position) > maxDistance || isBlockBlacklisted(pos)) continue;
      const block = bot.blockAt(pos);
      if (block && block.name === item.name && !positions.some(p => p.equals(pos))) positions.push(pos);
    }

    const now = Date.now();
    const unclaimedPositions = positions.filter(pos => {
      const key = posKey(pos);
      const claim = sc.claims.get(key);
      if (!claim || claim.expiresAt <= now || claim.owner === bot.username) {
        if (claim && claim.expiresAt <= now) sc.claims.delete(key);
        return true;
      }
      return false;
    });

    const botY = bot.entity.position.y;
    const botPos = bot.entity.position;
    const candidates = [];

    for (const pos of unclaimedPositions) {
      if (!pos || isBlockBlacklisted(pos)) continue;
      const dy = pos.y - botY;
      if (preferSameLevel && (dy > 4 || dy < -5)) continue;
      const blk = bot.blockAt(pos);
      if (!blk || !blk.position) continue;
      if (requireExposed && !isBlockExposed(blk)) continue;
      const horiz = Math.hypot(pos.x - botPos.x, pos.z - botPos.z);
      const score = horiz + Math.abs(dy) * 3.0;
      candidates.push({ blk, score });
    }

    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates.length ? candidates[0].blk : null;
    if (chosen) rememberSharedDiscovery(chosen);
    return chosen;
  }

  function buildStateVector() {
    if (!bot.entity) return new Array(22).fill(0);
    const pos = bot.entity.position;
    const threat = nearestHostile(16);
    const creeper = nearestCreeper(12);
    const distThreat = threat ? threat.position.distanceTo(pos) : 16;
    const distCreeper = creeper ? creeper.position.distanceTo(pos) : 12;
    const hasClutch = CLUTCH_ITEMS.some(c => inventoryCount(c) > 0) ? 1 : 0;
    const hasShield = (inventoryCount('shield') > 0 || bot.inventory.slots[45]?.name === 'shield') ? 1 : 0;

    let weaponRank = 0;
    for (let i = 0; i < SWORD_NAMES.length; i++) {
      if (inventoryCount(SWORD_NAMES[i]) > 0) {
        weaponRank = 1 - i / SWORD_NAMES.length;
        break;
      }
    }

    let pickRank = 0;
    for (let i = 0; i < PICKAXE_NAMES.length; i++) {
      if (inventoryCount(PICKAXE_NAMES[i]) > 0) {
        pickRank = 1 - i / PICKAXE_NAMES.length;
        break;
      }
    }

    let armorScore = 0;
    for (const slot of ARMOR_SLOTS) {
      const item = bot.inventory.slots[slot.index];
      if (item) {
        const tierIdx = ARMOR_TIERS.findIndex(t => item.name.startsWith(t));
        armorScore += tierIdx === -1 ? 0.2 : (1 - tierIdx / ARMOR_TIERS.length);
      }
    }

    const yaw = bot.entity.yaw;
    const frontPos = pos.floored().offset(Math.round(-Math.sin(yaw)), 0, Math.round(-Math.cos(yaw)));
    const frontBlock = bot.blockAt(frontPos);
    const frontFloor = bot.blockAt(frontPos.offset(0, -1, 0));
    const obstacleAhead = (frontBlock && !isBlockPassable(frontBlock)) ? 1 : 0;
    const hazardAhead = (frontFloor && (HAZARD_BLOCKS.has(frontFloor.name) || frontFloor.name === 'air')) ? 1 : 0;

    const groundDist = getDistanceToGround();
    const isNight = (bot.time?.timeOfDay >= 12541 && bot.time?.timeOfDay <= 23458) ? 1 : 0;
    const distBase = basePosition ? Math.min(1, pos.distanceTo(basePosition) / 64) : 0;
    const sc = ensureSwarmContext();
    const activeReqs = sc.requests.filter(r => r.expiresAt > Date.now()).length;
    const inNether = bot.game?.dimension === 'the_nether' ? 1 : 0;

    return [
      (bot.health || 20) / 20,
      (bot.food || 20) / 20,
      Math.min(1, Math.max(0, -bot.entity.velocity.y / 3)),
      Math.min(1, groundDist / 40),
      Math.min(1, distThreat / 16),
      threat ? 1 : 0,
      Math.min(1, distCreeper / 12),
      Math.min(1, countNearbyHostiles(12) / 5),
      hasClutch,
      hasShield,
      weaponRank,
      armorScore / 4,
      isNight,
      getAllInventoryItems().length / 36,
      obstacleAhead,
      hazardAhead,
      (state.stage || 1) / 7,
      distBase,
      Math.min(1, countNearbyTeammates(32) / 5),
      Math.min(1, activeReqs / 5),
      inNether,
      pickRank
    ];
  }

  // ========================================
  // AUTO-JUMP, PARKOUR & MLG CLUTCH
  // ========================================

  function getDistanceToGround() {
    if (!bot.entity) return 0;
    const pos = bot.entity.position.floored();
    for (let dy = 1; dy <= 40; dy++) {
      const blk = bot.blockAt(pos.offset(0, -dy, 0));
      if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && blk.name !== 'void_air') {
        return bot.entity.position.y - (blk.position.y + 1);
      }
    }
    return 40;
  }

  function autoJumpTick() {
    if (!bot.entity || dodgeRunning || recoveringFromStuck || isActivelyDigging) return;
    const now = Date.now();
    const pos = bot.entity.position;
    const moving = Boolean(
      bot.controlState.forward ||
      bot.pathfinder?.isMoving() ||
      combatTarget
    );
    if (!moving) return;

    if (bot.entity.isInWater) {
      if (!swimTick()) setCtrl('jump', true);
      return;
    }

    if (!bot.entity.onGround || now - lastAutoJumpAt < 340) return;

    const vx = bot.entity.velocity.x;
    const vz = bot.entity.velocity.z;
    const speed = Math.hypot(vx, vz);
    const dirX = speed > 0.03 ? vx / speed : -Math.sin(bot.entity.yaw);
    const dirZ = speed > 0.03 ? vz / speed : -Math.cos(bot.entity.yaw);

    const aheadFeetPos = pos.offset(dirX * 0.85, 0, dirZ * 0.85).floored();
    const aheadBlock = bot.blockAt(aheadFeetPos);
    const aheadAbove1 = bot.blockAt(aheadFeetPos.offset(0, 1, 0));
    const aheadAbove2 = bot.blockAt(aheadFeetPos.offset(0, 2, 0));
    const selfAbove = bot.blockAt(pos.floored().offset(0, 2, 0));

    // Auto-jump over 1-block obstacle when headroom is clear
    if (
      aheadBlock && !isBlockPassable(aheadBlock) && !HAZARD_BLOCKS.has(aheadBlock.name) &&
      isBlockPassable(aheadAbove1) && isBlockPassable(aheadAbove2) && isBlockPassable(selfAbove)
    ) {
      lastAutoJumpAt = now;
      bot.setControlState('jump', true);
      setTimeout(() => { try { if (!bot.entity?.isInWater) bot.setControlState('jump', false); } catch {} }, 180);
      return;
    }

    // Edge-timed Parkour jump across 1-3 block gaps when navigating
    if (bot.pathfinder?.goal && speed > 0.09) {
      const belowAhead = bot.blockAt(aheadFeetPos.offset(0, -1, 0));
      const twoBelowAhead = bot.blockAt(aheadFeetPos.offset(0, -2, 0));
      if (isBlockPassable(belowAhead) && isBlockPassable(twoBelowAhead)) {
        let [jumpTiming, sprintMomentum, lavaCaution] = [0.6, 0.7, 0.5];
        if (now - lastParkourEvalAt > 450) {
          lastParkourEvalAt = now;
          [jumpTiming, sprintMomentum, lavaCaution] = evo.decideSkill('parkour', buildStateVector(), null, agentSlot);
        }
        let hasLanding = false;
        for (const dist of [2, 3]) {
          const land = pos.offset(dirX * dist, 0, dirZ * dist).floored();
          const landFloor = bot.blockAt(land.offset(0, -1, 0));
          const landFloor2 = bot.blockAt(land.offset(0, -2, 0));
          if (isBlockSolidFloor(landFloor) || isBlockSolidFloor(landFloor2)) {
            hasLanding = true;
            break;
          }
        }
        const dangerBelow = belowAhead && HAZARD_BLOCKS.has(belowAhead.name);
        if (hasLanding && (!dangerBelow || lavaCaution < 0.85) && jumpTiming > 0.2) {
          lastAutoJumpAt = now;
          if (sprintMomentum > 0.45) bot.setControlState('sprint', true);
          bot.setControlState('jump', true);
          setTimeout(() => { try { if (!bot.entity?.isInWater) bot.setControlState('jump', false); } catch {} }, 210);
        }
      }
    }
  }

  // ========================================
  // SWIMMING SKILL (float, swim toward goals, drown-proofing)
  // ========================================
  let lastSwimPulseAt = 0;

  function swimTick() {
    if (!bot.entity || !bot.entity.isInWater) return false;
    const now = Date.now();

    const headBlock = bot.blockAt(bot.entity.position.offset(0, 1.62, 0).floored());
    const headSubmerged = Boolean(headBlock && (headBlock.name === 'water' || headBlock.name === 'flowing_water'));
    const oxygen = typeof bot.oxygen === 'number' ? bot.oxygen : 20;

    // 1. Drowning prevention: burst-swim straight up to the surface when air is low
    if (headSubmerged && oxygen <= 7) {
      setCtrl('sprint', false);
      setCtrl('forward', false);
      setCtrl('jump', true);
      return true;
    }

    // 2. Swim toward the active pathfinder goal / guarded player
    const hasGoal = Boolean(bot.pathfinder?.goal);
    setCtrl('forward', hasGoal);

    // 3. Buoyancy: pulse jump when sinking so the bot floats instead of walking on the bottom
    if ((!hasGoal || headSubmerged) && bot.entity.velocity.y < -0.18 && now - lastSwimPulseAt > 400) {
      lastSwimPulseAt = now;
      setCtrl('jump', true);
      setTimeout(() => { try { if (bot.entity?.isInWater) setCtrl('jump', false); } catch {} }, 220);
    }
    return true;
  }

  function observeParkourTick() {
    if (!bot.entity || !bot.pathfinder) return;
    const now = Date.now();
    const grounded = Boolean(bot.entity.onGround);
    const hasNavigationGoal = Boolean(bot.pathfinder.goal);

    if (
      !activeParkourAttempt && hasNavigationGoal &&
      lastPhysicsGrounded && !grounded &&
      bot.entity.velocity && bot.entity.velocity.y > 0.08 &&
      !bot.entity.isInWater
    ) {
      const stateVector = buildStateVector();
      activeParkourAttempt = {
        startedAt: now,
        start: bot.entity.position.clone(),
        startHealth: bot.health,
        stateVector,
        actionParams: evo.decideSkill('parkour', stateVector, null, agentSlot)
      };
    }

    if (activeParkourAttempt && grounded) {
      const attempt = activeParkourAttempt;
      const elapsed = now - attempt.startedAt;
      const dx = bot.entity.position.x - attempt.start.x;
      const dz = bot.entity.position.z - attempt.start.z;
      const horizontalDistance = Math.hypot(dx, dz);
      if (elapsed >= 120 && elapsed <= 3200 && horizontalDistance >= 1.1) {
        const safeLanding = bot.health >= attempt.startHealth - 2 && !bot.entity.isInWater;
        evo.recordExperience({
          skill: 'parkour',
          situation: {
            horizontalDistance: Number(horizontalDistance.toFixed(2)),
            elapsedMs: elapsed,
            startY: Number(attempt.start.y.toFixed(2)),
            endY: Number(bot.entity.position.y.toFixed(2))
          },
          actionParams: attempt.actionParams,
          success: safeLanding,
          reward: safeLanding ? 0.65 + Math.min(0.6, horizontalDistance * 0.2) : -0.8,
          healthDelta: bot.health - attempt.startHealth,
          evidence: safeLanding ? 'parkour_jump_landed' : 'parkour_landing_damage',
          stateVector: attempt.stateVector,
          agentSlot,
          metricUpdates: safeLanding ? { parkourSuccesses: 1 } : null
        });
      }
      activeParkourAttempt = null;
    } else if (activeParkourAttempt && now - activeParkourAttempt.startedAt > 3600) {
      const attempt = activeParkourAttempt;
      evo.recordExperience({
        skill: 'parkour',
        situation: { elapsedMs: now - attempt.startedAt, outcome: 'jump_timeout' },
        actionParams: attempt.actionParams,
        success: false,
        reward: -0.5,
        healthDelta: bot.health - attempt.startHealth,
        evidence: 'parkour_timeout',
        stateVector: attempt.stateVector,
        agentSlot
      });
      activeParkourAttempt = null;
    }

    lastPhysicsGrounded = grounded;
  }

  async function checkAndPerformMLG() {
    if (
      !bot.entity ||
      mlgActive ||
      bot.entity.onGround ||
      bot.entity.isInWater ||
      Date.now() - lastMlgAttempt < 2200
    ) {
      return false;
    }

    const vy = bot.entity.velocity.y;
    if (vy > -0.45) return false;

    const groundDist = getDistanceToGround();
    if (groundDist < 2.2) return false;

    const clutchItem = getBestItem(CLUTCH_ITEMS);
    if (!clutchItem) return false;

    const stateVec = buildStateVector();
    const [triggerThresh, timingBias] = evo.decideSkill('mlg', stateVec, null, agentSlot);
    const triggerHeight = 1.6 + triggerThresh * 3.0 + (timingBias - 0.5) * 0.8;

    if (groundDist > triggerHeight + Math.abs(vy) * 1.4) return false;

    mlgActive = true;
    activeSkillContext = 'mlg';
    lastMlgAttempt = Date.now();
    const startHp = bot.health;
    let placedWaterPos = null;
    let evidence = null;

    try {
      const pos = bot.entity.position.floored();
      let groundBlock = null;
      for (let dy = 1; dy <= 6; dy++) {
        const blk = bot.blockAt(pos.offset(0, -dy, 0));
        if (blk && blk.name !== 'air' && blk.name !== 'water') {
          groundBlock = blk;
          break;
        }
      }

      if (!groundBlock) return false;

      await bot.equip(clutchItem, 'hand');
      await bot.lookAt(groundBlock.position.offset(0.5, 1.0, 0.5), true);

      if (clutchItem.name === 'water_bucket') {
        bot.activateItem();
        placedWaterPos = groundBlock.position.offset(0, 1, 0);
      } else {
        await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
      }

      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && bot.entity && !bot.entity.onGround && !bot.entity.isInWater) {
        await sleep(50);
      }

      if (placedWaterPos && bot.entity) {
        await sleep(150);
        const bucket = getBestItem(['bucket']);
        if (bucket) {
          try {
            await bot.equip(bucket, 'hand');
            await bot.lookAt(placedWaterPos.offset(0.5, 0.2, 0.5), true);
            bot.activateItem();
          } catch {}
        }
      }

      const hpLost = Math.max(0, startHp - (bot.health || 0));
      const success = (bot.health || 0) > 0 && hpLost <= 3;
      if (!success) evidence = groundDist > 4.2 ? 'mlg_placed_too_early' : 'mlg_placed_late_or_missed';

      evo.recordExperience({
        skill: 'mlg',
        situation: { height: Number(groundDist.toFixed(2)), vy: Number(vy.toFixed(2)), item: clutchItem.name },
        actionParams: [triggerThresh, timingBias, 0.8, 0.5],
        success,
        reward: success ? 2.2 : -1.4,
        healthDelta: -hpLost,
        evidence,
        stateVector: stateVec,
        agentSlot
      });
      return true;
    } catch (err) {
      evo.recordExperience({
        skill: 'mlg',
        situation: { height: groundDist, vy, item: clutchItem.name },
        actionParams: [triggerThresh, timingBias, 0.5, 0.5],
        success: false,
        reward: -1.2,
        evidence: err.message,
        stateVector: stateVec,
        agentSlot
      });
      return false;
    } finally {
      mlgActive = false;
    }
  }

  // ========================================
  // TRUE CRITICAL-HIT PVP & COMBAT ENGINE
  // ========================================

  function getWeaponCooldownMs() {
    const held = bot.heldItem?.name || '';
    if (held.endsWith('_axe')) return 1000;
    if (held.endsWith('_sword')) return 625;
    if (held.endsWith('_pickaxe')) return 835;
    return 650;
  }

  function stopCombat() {
    const prevTargetId = combatTarget?.id;
    combatTarget = null;
    try { bot.pvp?.stop(); } catch {}
    if (isShieldRaised) {
      isShieldRaised = false;
      try { bot.deactivateItem(); } catch {}
    }
    try {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      bot.setControlState('left', false);
      bot.setControlState('right', false);
      bot.setControlState('jump', false);
    } catch {}
    // Only clear GoalFollow if it was chasing the enemy, NEVER clear GoalFollow(guardedPlayer)!
    if (bot.pathfinder?.goal instanceof GoalFollow && bot.pathfinder.goal.entity?.id === prevTargetId) {
      setGoal(null);
    }
  }

  async function combatStrafeDodge(target) {
    if (!config.dodge.enabled || !bot.entity || !target || dodgeRunning || Date.now() - lastDefenseDodge < 2000) {
      return false;
    }
    dodgeRunning = true;
    lastDefenseDodge = Date.now();
    try {
      const side = Math.random() > 0.5 ? 'left' : 'right';
      await bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true);
      bot.setControlState(side, true);
      bot.setControlState('back', true);
      await sleep(220);
      bot.setControlState(side, false);
      bot.setControlState('back', false);
    } catch {} finally {
      try {
        bot.setControlState('left', false);
        bot.setControlState('right', false);
        bot.setControlState('back', false);
      } catch {}
      dodgeRunning = false;
    }
    return true;
  }

  function smartCombatTick() {
    if (!combatTarget || !bot.entity || bot.health <= 0 || Date.now() < respawnGraceUntil) {
      stopCombat();
      return;
    }

    if (combatTarget.isValid === false || (combatTarget.health !== undefined && combatTarget.health <= 0)) {
      stopCombat();
      return;
    }

    const target = combatTarget;
    const dist = target.position.distanceTo(bot.entity.position);
    if (dist > 28) {
      stopCombat();
      return;
    }

    const now = Date.now();
    if (now - lastCombatEvalAt > 350) {
      lastCombatEvalAt = now;
      cachedCombatParams = evo.decideSkill('pvp', buildStateVector(), target.name || target.username, agentSlot);
    }
    const [aggression, dodgeTendency, critTiming, retreatBias] = cachedCombatParams;

    const retreatHp = 5 + retreatBias * 3;
    if (bot.health <= retreatHp && dist < 8) {
      requestSwarmCombatHelp(target);
      stopCombat();
      const dx = bot.entity.position.x - target.position.x;
      const dz = bot.entity.position.z - target.position.z;
      const len = Math.hypot(dx, dz) || 1;
      useNavigationMovements();
      setGoal(new GoalXZ(
        Math.floor(bot.entity.position.x + (dx / len) * 14),
        Math.floor(bot.entity.position.z + (dz / len) * 14)
      ));
      return;
    }

    if (
      now - lastCombatHelpAt > 4000 &&
      (bot.health < 14 || countNearbyHostiles(9) >= 2 || target.type === 'player')
    ) {
      requestSwarmCombatHelp(target);
    }

    if (dist > 3.6) {
      if (isShieldRaised) { isShieldRaised = false; try { bot.deactivateItem(); } catch {} }
      const goal = bot.pathfinder?.goal;
      if (!(goal instanceof GoalFollow) || goal.entity?.id !== target.id) {
        useNavigationMovements();
        setGoal(new GoalFollow(target, 1.5), true);
      }
      return;
    }

    if (bot.pathfinder?.goal) setGoal(null);

    const aimPos = target.position.offset(0, (target.height || 1.8) * 0.72, 0);
    if (now - lastCombatLookAt > 180) {
      lastCombatLookAt = now;
      bot.lookAt(aimPos, false).catch(() => {});
    }

    const cooldownMs = getWeaponCooldownMs();
    const elapsed = now - lastMeleeAttackAt;
    const cooldownPct = elapsed / cooldownMs;

    const hasShield = bot.inventory.slots[45]?.name === 'shield';
    if (hasShield && cooldownPct < 0.55 && dist <= 4.0 && !isShieldRaised && now > shieldBlockingUntil) {
      try { bot.activateItem(true); isShieldRaised = true; } catch {}
      shieldBlockingUntil = now + 260;
    } else if (isShieldRaised && (cooldownPct >= 0.55 || now >= shieldBlockingUntil)) {
      isShieldRaised = false;
      try { bot.deactivateItem(); } catch {}
    }

    if (!dodgeRunning && aggression > 0.35) {
      const strafeDir = Math.floor(now / 700) % 2 === 0 ? 'left' : 'right';
      setCtrl(strafeDir, true);
      setCtrl(strafeDir === 'left' ? 'right' : 'left', false);
    }
    setCtrl('forward', dist > 2.2);

    const headAbove = bot.blockAt(bot.entity.position.floored().offset(0, 2, 0));
    const headroomClear = !headAbove || isBlockPassable(headAbove);
    const wantCrit = headroomClear && !bot.entity.isInWater && critTiming > 0.22;

    if (
      wantCrit &&
      bot.entity.onGround &&
      cooldownPct >= 0.45 &&
      now - critJumpTriggeredAt > 480 &&
      dist <= 3.55
    ) {
      critJumpTriggeredAt = now;
      bot.setControlState('sprint', false);
      bot.setControlState('jump', true);
      setTimeout(() => { try { if (!bot.entity?.isInWater) bot.setControlState('jump', false); } catch {} }, 130);
    }

    // Falling-phase Critical Strike OR full-cooldown ground fallback
    const isFalling = !bot.entity.onGround && bot.entity.velocity.y < -0.055 && !bot.entity.isInWater;
    const canCritHit = isFalling && cooldownPct >= 0.88 && dist <= 3.35;
    const canGroundFallback = cooldownPct >= 1.0 && (elapsed >= cooldownMs + 260 || !wantCrit) && dist <= 3.2;

    if (canCritHit || canGroundFallback) {
      if (isShieldRaised) { isShieldRaised = false; try { bot.deactivateItem(); } catch {} }
      bot.lookAt(aimPos, false).catch(() => {});
      bot.setControlState('sprint', false);
      try {
        bot.attack(target);
        lastMeleeAttackAt = now;
        if (activeCombatEncounter && activeCombatEncounter.targetId === target.id) {
          activeCombatEncounter.hits = (activeCombatEncounter.hits || 0) + 1;
          if (canCritHit) activeCombatEncounter.crits = (activeCombatEncounter.crits || 0) + 1;
          activeCombatEncounter.actionParams = [aggression, dodgeTendency, critTiming, retreatBias];
          activeCombatEncounter.lastDistance = Number(dist.toFixed(1));
        }
        if (canCritHit) log(`[CRIT HIT] Landed critical strike on ${target.name || target.username}!`);
      } catch {}
    }
  }

  async function upgradeArmor() {
    if (!bot.entity) return;
    for (const armorSlot of ARMOR_SLOTS) {
      const candidates = [];
      for (const tier of ARMOR_TIERS) {
        const item = getAllInventoryItems().find(s => s.name === `${tier}${armorSlot.suffix}`);
        if (item) candidates.push({ item, tier });
      }
      if (!candidates.length) continue;

      const best = candidates[0];
      const currentlyEquipped = bot.inventory.slots[armorSlot.index];
      const curIdx = currentlyEquipped
        ? ARMOR_TIERS.indexOf(currentlyEquipped.name.replace(armorSlot.suffix, ''))
        : -1;
      const currentRank = curIdx === -1 ? 999 : curIdx;
      const bestRank = ARMOR_TIERS.indexOf(best.tier);

      if (bestRank !== -1 && bestRank < currentRank) {
        try {
          await bot.equip(best.item, armorSlot.slot);
          log(`Armor upgraded: ${best.item.name}`);
        } catch {}
      }
    }
  }

  async function equipShield() {
    if (!bot.entity) return;
    if (bot.inventory.slots[45]?.name === 'shield') return;
    const shield = getAllInventoryItems().find(i => i.name === 'shield');
    if (!shield) return;
    try { await bot.equip(shield, 'off-hand'); } catch {}
  }

  async function equipBestWeapon() {
    const weapon = getBestItem(SWORD_NAMES) || getBestItem(AXE_NAMES);
    if (!weapon) return;
    try { if (bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand'); } catch {}
  }

  async function equipBestPickaxe() {
    const pick = getBestItem(PICKAXE_NAMES);
    if (!pick) return;
    try { if (bot.heldItem?.name !== pick.name) await bot.equip(pick, 'hand'); } catch {}
  }

  async function equipBestAxe() {
    const axe = getBestItem(AXE_NAMES);
    if (!axe) return;
    try { if (bot.heldItem?.name !== axe.name) await bot.equip(axe, 'hand'); } catch {}
  }

  async function eatFood(force = false) {
    if (!bot.entity || (!force && bot.food >= 18)) return false;
    const food = chooseSmartFood(bot.health, bot.food);
    if (!food) return false;

    try {
      clearMovement();
      await bot.equip(food, 'hand');
      await withTimeout(bot.consume(), 4000, 'consume');
      log(`Ate ${food.name}`);
      return true;
    } catch {
      return false;
    }
  }

  async function avoidCreepers() {
    if (!bot.entity) return false;
    const margin = 5.5 + (evo.environmentModel.skillAdjustments?.creeperMarginBoost || 0);
    const creeper = nearestCreeper(margin);
    if (!creeper) return false;

    activeSkillContext = 'defense';
    lastCombatTargetName = 'creeper';
    lastCombatTimestamp = Date.now();
    stopCombat();
    if (taskStateRef.isRunning()) await taskStateRef.interrupt('Creeper nearby');

    const dx = bot.entity.position.x - creeper.position.x;
    const dz = bot.entity.position.z - creeper.position.z;
    const len = Math.hypot(dx, dz) || 1;
    useNavigationMovements();
    setGoal(new GoalXZ(
      Math.floor(bot.entity.position.x + (dx / len) * (margin + 4)),
      Math.floor(bot.entity.position.z + (dz / len) * (margin + 4))
    ));
    return true;
  }

  async function engageMobTarget(target, skillContext = 'pvp') {
    if (!target || !bot.entity) return false;
    if (combatTarget?.id === target.id) return true;

    activeCombatEncounter = {
      targetId: target.id,
      name: target.name || target.username || 'mob',
      skill: skillContext,
      startedAt: Date.now(),
      startHealth: bot.health,
      stateVector: buildStateVector(),
      actionParams: null,
      hits: 0,
      crits: 0
    };

    activeSkillContext = skillContext;
    lastCombatTargetName = target.name || target.username || 'mob';
    lastCombatTimestamp = Date.now();

    if (taskStateRef.isRunning()) {
      await taskStateRef.interrupt(`Combat: ${lastCombatTargetName}`);
    }

    await upgradeArmor();
    await equipShield();
    await equipBestWeapon();

    combatTarget = target;
    // Squad Unity: alert nearby teammates immediately so the team fights together
    if (skillContext !== 'cooperation') {
      ensureSwarmContext().focusTargetId = target.id;
      requestSwarmCombatHelp(target);
    }
    log(`[COMBAT] Engaging ${lastCombatTargetName} with Critical-Hit controller`);
    return true;
  }

  async function defensiveCombat() {
    if (!bot.entity || bot.health <= 10 || bot.food <= 7) return false;
    const target = nearestHostile(5.5);
    if (!target) return false;
    return await engageMobTarget(target, 'pvp');
  }

  function setGuardOrder(username, mode = 'defend', fallbackPos = null) {
    guardUsername = username || null;
    guardMode = username ? mode : null;
    guardFallbackPos = fallbackPos ? fallbackPos.clone() : null;
    if (!username) {
      playerDefendTargetId = null;
      playerDefendUntil = 0;
    }
  }

  async function protectFriendlyPlayer() {
    if (!guardUsername || !bot.entity || revengeTargetName) return false;
    const sc = ensureSwarmContext();
    const player = findPlayerEntity(guardUsername);

    if (player) {
      guardFallbackPos = player.position.clone();
      sc.guardedPlayerPos = {
        username: guardUsername,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        at: Date.now()
      };
    }

    // 1. If in DEFEND mode, actively intercept mobs & attackers around player (16m radius!)
    if (guardMode === 'defend' && bot.health > 5) {
      let threat = null;
      if (playerDefendTargetId && Date.now() < playerDefendUntil) {
        const tracked = bot.entities[playerDefendTargetId];
        if (tracked && tracked.isValid !== false && tracked.position.distanceTo(bot.entity.position) <= 24) {
          threat = tracked;
        } else {
          playerDefendTargetId = null;
        }
      }
      if (!threat && player) threat = nearestHostile(16, player.position);
      if (!threat) threat = nearestHostile(10, bot.entity.position);

      if (threat) {
        await engageMobTarget(threat, 'defense');
        return true;
      }
    }

    // If enemy died or went far while defending, clear combatTarget cleanly
    if (combatTarget && combatTarget.position.distanceTo(bot.entity.position) > 20 && player && bot.entity.position.distanceTo(player.position) > 12) {
      stopCombat();
    }

    // 2. Follow logic (runs in BOTH !follow and !defend modes!)
    if (combatTarget) return true;

    const followDist = guardMode === 'follow'
      ? (1.8 + (agentSlot % 3) * 0.6)
      : (2.4 + (agentSlot % 3) * 0.7);

    if (player) {
      const dist = bot.entity.position.distanceTo(player.position);
      if (dist > followDist + 0.8) {
        const goal = bot.pathfinder?.goal;
        const alreadyFollowing = goal instanceof GoalFollow && goal.entity?.id === player.id;
        if (!alreadyFollowing) {
          useNavigationMovements();
          setGoal(new GoalFollow(player, followDist), true);
        }
      }
      return true;
    }

    // 3. Player is >45 blocks away (outside this bot's view) -> walk to shared coordinates to catch up!
    const sharedPos = (sc.guardedPlayerPos && Date.now() - sc.guardedPlayerPos.at < 15000)
      ? sc.guardedPlayerPos
      : guardFallbackPos;

    if (sharedPos) {
      const dest = new Vec3(sharedPos.x, sharedPos.y, sharedPos.z);
      if (bot.entity.position.distanceTo(dest) > 4) {
        useNavigationMovements();
        setGoal(new GoalNear(Math.floor(dest.x), Math.floor(dest.y), Math.floor(dest.z), 3), true);
      }
    }
    return true;
  }

  function startPlayerRevenge(player) {
    if (
      !config.pvp.enabled ||
      !config.pvp.retaliationEnabled ||
      !bot.entity ||
      !player?.username ||
      isProtectedPlayer(player.username)
    ) return;

    revengeTargetName = player.username;
    revengeUntil = Date.now() + config.pvp.revengeDuration;
    activeSkillContext = 'pvp';
    lastCombatTargetName = player.username;
    lastCombatTimestamp = Date.now();

    log(`PLAYER ATTACK DETECTED: ${player.username}`);
    requestSwarmCombatHelp(player);

    if (taskStateRef.isRunning()) {
      taskStateRef.interrupt('Player attacked bot').catch(() => {});
    }
    stopCombat();

    upgradeArmor()
      .then(() => equipShield())
      .then(() => equipBestWeapon())
      .then(() => {
        const target = findPlayerEntity(revengeTargetName);
        if (target && bot.entity && !isProtectedPlayer(revengeTargetName)) {
          engageMobTarget(target, 'pvp').catch(() => {});
        }
      }).catch(() => {});
  }

  function playerRevengeTick() {
    if (!revengeTargetName || !bot.entity) return false;
    if (Date.now() > revengeUntil) {
      revengeTargetName = null;
      stopCombat();
      return false;
    }

    const player = findPlayerEntity(revengeTargetName);
    if (!player || player.isValid === false || isProtectedPlayer(revengeTargetName)) {
      revengeTargetName = null;
      stopCombat();
      return false;
    }

    if (player.position.distanceTo(bot.entity.position) > config.pvp.attackRange) {
      revengeTargetName = null;
      stopCombat();
      return false;
    }

    if (combatTarget?.id !== player.id) {
      engageMobTarget(player, 'pvp').catch(() => {});
    }
    return true;
  }

  function onEntityDead(entity) {
    const encounter = activeCombatEncounter;
    if (!entity) return false;
    if (combatTarget && entity.id === combatTarget.id) stopCombat();
    if (!encounter || entity.id !== encounter.targetId) return false;

    const elapsedMs = Date.now() - encounter.startedAt;
    const crits = encounter.crits || 0;
    const hpDelta = bot.health - encounter.startHealth;
    const reward = 1.1 + crits * 0.55 + Math.max(-0.5, hpDelta / 12);

    evo.recordExperience({
      skill: encounter.skill,
      situation: {
        enemy: encounter.name,
        elapsedMs,
        crits,
        hits: encounter.hits || 0,
        startHealth: encounter.startHealth,
        endHealth: bot.health
      },
      actionParams: encounter.actionParams || [0.6, 0.5, 0.7, 0.4],
      success: true,
      reward,
      healthDelta: hpDelta,
      evidence: crits > 0 ? `killed_with_${crits}_crits` : 'target_entity_dead',
      stateVector: encounter.stateVector,
      agentSlot,
      metricUpdates: { kills: 1, critsLanded: crits, damageDealt: 20 }
    });
    if (!taskStateRef.isRunning()) {
      setTimeout(() => { pickupNearbyDrops(6.0).catch(() => {}); }, 300);
    }
    activeCombatEncounter = null;
    return true;
  }

  function onEntitySwingArm(entity) {
    if (!bot.entity || !entity || entity.type !== 'player') return;
    if (!entity.username || isProtectedPlayer(entity.username)) return;
    const guarded = guardUsername ? findPlayerEntity(guardUsername) : null;
    const nearBot = entity.position.distanceTo(bot.entity.position) <= 6;
    const nearGuarded = guarded && entity.position.distanceTo(guarded.position) <= 6;
    if (nearBot || nearGuarded) {
      recentPlayerSwings.set(entity.id, { username: entity.username, time: Date.now() });
    }
  }

  function onEntityHurt(entity) {
    if (!bot.entity || !entity) return;

    // 1. Defend the guarded player immediately if THEY get hurt!
    if (
      guardUsername &&
      guardMode === 'defend' &&
      entity.type === 'player' &&
      normalizePlayerName(entity.username) === normalizePlayerName(guardUsername)
    ) {
      let attacker = nearestHostile(16, entity.position);
      if (!attacker) {
        const now = Date.now();
        for (const [id, data] of recentPlayerSwings.entries()) {
          const p = Object.values(bot.players).find(pl => pl.entity?.id === id);
          if (p?.entity && now - data.time <= 2500 && p.entity.position.distanceTo(entity.position) <= 6) {
            attacker = p.entity;
            break;
          }
        }
      }
      if (attacker) {
        playerDefendTargetId = attacker.id;
        playerDefendUntil = Date.now() + 20000;
        engageMobTarget(attacker, 'defense').catch(() => {});
      }
      return;
    }

    if (entity.id !== bot.entity.id) return;

    const nearMob = nearestHostile(5) || nearestCreeper(6);
    if (nearMob) {
      lastCombatTargetName = nearMob.name;
      lastCombatTimestamp = Date.now();
      evo.recordThreatEncounter(nearMob.name, 3);
    }

    const now = Date.now();
    if (now - lastPlayerAttack < config.pvp.targetCooldown) return;
    lastPlayerAttack = now;

    let attacker = null;
    let newestAge = Infinity;
    for (const [id, data] of recentPlayerSwings.entries()) {
      const player = Object.values(bot.players).find(p => p.entity?.id === id);
      if (!player?.entity) continue;
      const age = now - data.time;
      if (age >= 0 && age <= 2000 && age < newestAge && player.entity.position.distanceTo(bot.entity.position) <= 6) {
        attacker = player.entity;
        newestAge = age;
      }
    }

    if (attacker) {
      lastCombatTargetName = attacker.username;
      lastCombatTimestamp = Date.now();
      evo.recordThreatEncounter(attacker.username, 4);
      startPlayerRevenge(attacker);
    }
  }

  setInterval(() => {
    const now = Date.now();
    for (const [id, data] of recentPlayerSwings.entries()) {
      if (now - data.time > 3000) recentPlayerSwings.delete(id);
    }
  }, 2000);

  // ========================================
  // SWARM COOPERATION PROTOCOL (GROUP HELP!)
  // ========================================

  function postHelpRequest(type, payload = {}, ttlMs = 20000) {
    if (!bot.entity) return null;
    const sc = ensureSwarmContext();
    const now = Date.now();
    sc.requests = sc.requests.filter(r => r.expiresAt > now);

    const existing = sc.requests.find(
      r => r.requester === bot.username && r.type === type && r.itemName === payload.itemName
    );
    if (existing) {
      existing.position = bot.entity.position.clone();
      existing.expiresAt = now + ttlMs;
      return existing;
    }

    const req = {
      id: `${bot.username}_${type}_${now}`,
      type,
      requester: bot.username,
      position: bot.entity.position.clone(),
      urgency: payload.urgency || 1,
      itemName: payload.itemName || null,
      count: payload.count || 1,
      targetEntityId: payload.targetEntityId || null,
      claimedBy: null,
      createdAt: now,
      expiresAt: now + ttlMs
    };
    sc.requests.push(req);
    return req;
  }

  function requestSwarmCombatHelp(target) {
    if (!target || !bot.entity) return;
    lastCombatHelpAt = Date.now();
    postHelpRequest('COMBAT_HELP', {
      targetEntityId: target.id,
      urgency: bot.health < 12 ? 3 : 2
    }, 15000);
  }

  function requestSwarmResourceHelp(itemName, count = 1, urgency = 1) {
    const now = Date.now();
    if (now - lastResourceRequestAt < 8000) return;
    lastResourceRequestAt = now;
    postHelpRequest('RESOURCE_HELP', { itemName, count, urgency }, 22000);
  }

  function getSurplusItemForRequest(req) {
    if (!req?.itemName) return null;
    const name = req.itemName;
    if (name === 'wooden_pickaxe' || name === 'stone_pickaxe' || name === 'iron_pickaxe') {
      const ownPicks = PICKAXE_NAMES.reduce((s, p) => s + inventoryCount(p), 0);
      if (ownPicks >= 2) {
        const item = getAllInventoryItems().find(i => i.name === name);
        if (item) return { item, shareCount: 1 };
      }
      return null;
    }
    if (name === 'food') {
      const total = getTotalEdibleFood();
      if (total >= 6) {
        const item = getBestItem(FOOD_ITEMS);
        if (item) return { item, shareCount: Math.min(3, Math.floor(item.count / 2) || 1) };
      }
      return null;
    }
    if (name === 'wood') {
      if (getTotalWoodLogs() >= 6) {
        const item = getAllInventoryItems().find(i => LOG_NAMES.includes(i.name));
        if (item) return { item, shareCount: Math.min(4, Math.floor(item.count / 2) || 1) };
      }
      return null;
    }
    const minKeepMap = {
      cobblestone: 16,
      iron_ingot: 4,
      diamond: 3,
      coal: 4,
      obsidian: 10,
      netherite_ingot: 1
    };
    const keep = minKeepMap[name] ?? 2;
    const have = inventoryCount(name);
    if (have >= keep + req.count) {
      const item = getAllInventoryItems().find(i => i.name === name);
      if (item) return { item, shareCount: Math.min(req.count, have - keep) };
    }
    return null;
  }

  function getSwarmRole() {
    const roles = ['MINER', 'LUMBERJACK', 'HUNTER', 'CRAFTER_BUILDER'];
    const role = roles[agentSlot % roles.length];
    ensureSwarmContext().roles.set(bot.username, role);
    return role;
  }

  function findNearestTeammate(maxDist = 48) {
    if (!bot.entity) return null;
    let best = null;
    let bestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (e?.type === 'player' && e.isValid !== false && e.username !== bot.username && isSwarmBotName(e.username)) {
        const d = e.position.distanceTo(bot.entity.position);
        if (d <= maxDist && d < bestDist) {
          best = e;
          bestDist = d;
        }
      }
    }
    return best;
  }

  function updateTeamAnchor() {
    if (!bot.entity) return null;
    const sc = ensureSwarmContext();
    // Leader (slot 0) or basePosition keeps the squad anchor updated
    if (agentSlot === 0 || !sc.teamAnchor) {
      const anchorPos = basePosition || bot.entity.position;
      sc.teamAnchor = {
        x: Math.floor(anchorPos.x),
        y: Math.floor(anchorPos.y),
        z: Math.floor(anchorPos.z),
        updatedAt: Date.now()
      };
    }
    return sc.teamAnchor;
  }

  /**
   * Instant non-blocking Combat Unity check (runs every brainTick).
   */
  async function cooperationTick() {
    if (!bot.entity || bot.health <= 11 || bot.food <= 8) return false;
    getSwarmRole();
    updateTeamAnchor();
    const sc = ensureSwarmContext();
    const now = Date.now();
    sc.requests = sc.requests.filter(r => r.expiresAt > now);

    // 1. Rally order (!rally command)
    if (sc.rallyUntil > now && sc.teamAnchor) {
      const anchor = new Vec3(sc.teamAnchor.x, sc.teamAnchor.y, sc.teamAnchor.z);
      if (bot.entity.position.distanceTo(anchor) > 6 && !combatTarget) {
        useNavigationMovements();
        setGoal(new GoalNear(anchor.x, anchor.y, anchor.z, 3), true);
        return true;
      }
    }

    // 2. Squad Combat Unity: fight alongside teammates within 26 blocks!
    if (!combatTarget && Date.now() >= respawnGraceUntil) {
      const combatReq = sc.requests.find(
        r =>
          r.type === 'COMBAT_HELP' &&
          r.requester !== bot.username &&
          r.position.distanceTo(bot.entity.position) <= 26
      );
      const focusTarget = combatReq
        ? bot.entities[combatReq.targetEntityId]
        : (sc.focusTargetId ? bot.entities[sc.focusTargetId] : null);

      if (
        focusTarget &&
        focusTarget.isValid !== false &&
        !isProtectedPlayer(focusTarget.username) &&
        focusTarget.position.distanceTo(bot.entity.position) <= 24
      ) {
        log(`[UNITY] Joining teammate in combat vs ${focusTarget.name || focusTarget.username}!`);
        await engageMobTarget(focusTarget, 'cooperation');
        evo.recordExperience({
          skill: 'cooperation',
          situation: { type: 'united_combat', target: focusTarget.name || focusTarget.username },
          actionParams: [0.8, 0.7, 0.9, 0.8],
          success: true,
          reward: 1.4,
          evidence: 'united_squad_combat',
          stateVector: buildStateVector(),
          agentSlot,
          metricUpdates: { coopHelps: 1 }
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Returns an interruptible Team Unity task (Resource Delivery OR Squad Regroup)
   * so moveToGoal NEVER freezes brainTick!
   */
  function selectCoopActionTask() {
    if (!bot.entity || bot.health <= 11 || bot.food <= 8) return null;
    const sc = ensureSwarmContext();
    const now = Date.now();
    sc.requests = sc.requests.filter(r => r.expiresAt > now);

    // 1. Fulfill a teammate's item/tool request by tossing surplus
    for (const req of sc.requests) {
      if (
        req.type !== 'RESOURCE_HELP' ||
        req.requester === bot.username ||
        (req.claimedBy && req.claimedBy !== bot.username)
      ) continue;

      const ally = findPlayerEntity(req.requester);
      if (!ally || ally.position.distanceTo(bot.entity.position) > 42) continue;

      const surplus = getSurplusItemForRequest(req);
      if (!surplus) continue;

      req.claimedBy = bot.username;
      return {
        name: `coop_share_${surplus.item.name}`,
        priority: 86,
        execute: async () => {
          try {
            log(`[UNITY] Delivering ${surplus.shareCount}x ${surplus.item.name} to ${req.requester}`);
            await moveToGoal(new GoalNear(ally.position.x, ally.position.y, ally.position.z, 2), 9000, false);
            const currentAlly = findPlayerEntity(req.requester);
            if (currentAlly && currentAlly.position.distanceTo(bot.entity.position) <= 5.5) {
              await bot.lookAt(currentAlly.position.offset(0, 1.3, 0), true);
              await bot.toss(surplus.item.type, null, surplus.shareCount);
              sc.requests = sc.requests.filter(r => r.id !== req.id);
              evo.recordExperience({
                skill: 'cooperation',
                situation: { type: 'resource_share', item: surplus.item.name, count: surplus.shareCount },
                actionParams: [0.8, 0.85, 0.7, 0.8],
                success: true,
                reward: 1.6,
                resourcesUsed: surplus.shareCount,
                evidence: `shared_${surplus.item.name}`,
                stateVector: buildStateVector(),
                agentSlot,
                metricUpdates: { coopHelps: 1 }
              });
              return true;
            }
            return false;
          } finally {
            req.claimedBy = null;
          }
        }
      };
    }

    // 2. Squad Cohesion: only regroup after starter tools exist & no teammate is already nearby
    const anchor = sc.teamAnchor;
    if (
      anchor &&
      hasToolTierOrBetter(PICKAXE_NAMES, 'stone_pickaxe') &&
      !findNearestTeammate(22) &&
      bot.entity.position.y > 50 &&
      bot.game?.dimension === 'overworld'
    ) {
      const anchorVec = new Vec3(anchor.x, anchor.y, anchor.z);
      if (bot.entity.position.distanceTo(anchorVec) > 42) {
        return {
          name: 'coop_regroup_squad',
          priority: 52,
          execute: async () => {
            log('[UNITY] Regrouping closer to squad anchor');
            return await moveToGoal(new GoalNear(anchor.x, anchor.y, anchor.z, 12), 9000, false);
          }
        };
      }
    }

    return null;
  }

  // ========================================
  // TRAPS, BARRICADES & BUILDING
  // ========================================

  function monitorTraps() {
    if (!bot.entity) return;
    const now = Date.now();
    for (let i = activeTraps.length - 1; i >= 0; i--) {
      const trap = activeTraps[i];
      if (now - trap.placedAt > 180000) {
        activeTraps.splice(i, 1);
        continue;
      }
      if (!trap.triggered) {
        for (const entity of Object.values(bot.entities)) {
          if (isHostileEntity(entity) || (entity.type === 'player' && !isProtectedPlayer(entity.username))) {
            if (entity.position.distanceTo(trap.pos) <= 1.6) {
              trap.triggered = true;
              evo.recordExperience({
                skill: 'traps',
                situation: { target: entity.name || entity.username, trapType: trap.type },
                actionParams: [0.6, 0.6, 0.6, 0.7],
                success: true,
                reward: 1.2,
                agentSlot
              });
              break;
            }
          }
        }
      }
    }
  }

  function avoidOwnTraps() {
    if (!bot.entity || !activeTraps.length) return false;
    for (const trap of activeTraps) {
      if (bot.entity.position.distanceTo(trap.pos) <= 2.3) {
        const dx = bot.entity.position.x - trap.pos.x;
        const dz = bot.entity.position.z - trap.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        setGoal(new GoalXZ(
          Math.floor(bot.entity.position.x + (dx / len) * 5),
          Math.floor(bot.entity.position.z + (dz / len) * 5)
        ));
        return true;
      }
    }
    return false;
  }

  async function placeStrategicTrap(force = false) {
    if (!bot.entity || !mcData) return false;
    activeSkillContext = 'traps';
    const trapItem = getBestItem(['sweet_berries', 'cactus', 'magma_block', 'cobweb', 'oak_pressure_plate']);
    const pos = bot.entity.position.floored();
    const yaw = bot.entity.yaw;
    const front = pos.offset(Math.round(-Math.sin(yaw)) * 4, 0, Math.round(-Math.cos(yaw)) * 4);
    if (!force && basePosition && front.distanceTo(basePosition) < 6) return false;

    const targetSpace = bot.blockAt(front);
    const ground = bot.blockAt(front.offset(0, -1, 0));
    if (!targetSpace || !ground) return false;

    if (trapItem && isBlockPassable(targetSpace) && !isBlockPassable(ground)) {
      try {
        clearMovement();
        await bot.equip(trapItem, 'hand');
        await bot.placeBlock(ground, new Vec3(0, 1, 0));
        activeTraps.push({ pos: front, type: trapItem.name, placedAt: Date.now(), triggered: false });
        blacklistColumn(front, 180000);
        return true;
      } catch {}
    }

    if (!isBlockPassable(ground) && isSafeToDigBlock(ground)) {
      const below = bot.blockAt(front.offset(0, -2, 0));
      if (below && below.name !== 'lava' && isSafeToDigBlock(below)) {
        try {
          isActivelyDigging = true;
          await equipBestPickaxe();
          await bot.dig(ground);
          await bot.dig(below);
          activeTraps.push({ pos: front.offset(0, -2, 0), type: 'pitfall', placedAt: Date.now(), triggered: false });
          blacklistColumn(front, 180000);
          return true;
        } catch {} finally {
          isActivelyDigging = false;
        }
      }
    }
    return false;
  }

  async function buildDefensiveBarricade(threat) {
    if (!bot.entity || !threat) return false;
    activeSkillContext = 'defense';
    const blockItem = getBestItem(BUILD_BLOCKS);
    if (!blockItem) return false;

    const dx = threat.position.x - bot.entity.position.x;
    const dz = threat.position.z - bot.entity.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const basePos = bot.entity.position.floored().offset(Math.round(dx / len) * 2, 0, Math.round(dz / len) * 2);

    let placed = 0;
    for (const off of [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 1, 0)]) {
      const p = basePos.plus(off);
      const space = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (isBlockPassable(space) && below && !isBlockPassable(below)) {
        try {
          await bot.equip(blockItem, 'hand');
          await bot.placeBlock(below, new Vec3(0, 1, 0));
          placed++;
        } catch {}
      }
    }

    if (placed > 0) {
      evo.recordExperience({
        skill: 'defense',
        situation: { barricadePlaced: placed, threat: threat.name },
        actionParams: [0.8, 0.8, 0.5, 0.5],
        success: true,
        reward: 0.85,
        resourcesUsed: placed,
        agentSlot
      });
      return true;
    }
    return false;
  }

  async function safeSneakBridge(steps = 4) {
    if (!bot.entity) return false;
    activeSkillContext = 'building';
    const blockItem = getBestItem(BUILD_BLOCKS);
    if (!blockItem) return false;

    const yaw = bot.entity.yaw;
    const dir = new Vec3(Math.round(-Math.sin(yaw)), 0, Math.round(-Math.cos(yaw)));
    if (dir.x === 0 && dir.z === 0) dir.x = 1;

    let placed = 0;
    try {
      clearMovement();
      await bot.equip(blockItem, 'hand');
      bot.setControlState('sneak', true);

      for (let i = 0; i < steps; i++) {
        if (taskStateRef.isInterrupted() || nearestHostile(6)) break;
        const curPos = bot.entity.position.floored();
        const nextFloor = curPos.plus(dir).offset(0, -1, 0);
        const curFloor = bot.blockAt(curPos.offset(0, -1, 0));
        const targetBlk = bot.blockAt(nextFloor);

        if (targetBlk && isBlockPassable(targetBlk) && curFloor && !isBlockPassable(curFloor)) {
          await bot.placeBlock(curFloor, dir);
          placed++;
        }
        bot.setControlState('forward', true);
        await sleep(320);
        bot.setControlState('forward', false);
      }

      evo.recordExperience({
        skill: 'building',
        situation: { task: 'bridge', stepsRequested: steps },
        actionParams: [0.9, 0.7, 0.8, 0.5],
        success: placed > 0,
        reward: placed > 0 ? 0.9 : -0.4,
        resourcesUsed: placed,
        agentSlot
      });
      return placed > 0;
    } catch {
      return false;
    } finally {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', false);
      } catch {}
    }
  }

  async function buildQuickShelter() {
    if (!bot.entity) return false;
    activeSkillContext = 'building';
    const blockItem = getBestItem(BUILD_BLOCKS);
    if (!blockItem || blockItem.count < 16) return false;

    const center = bot.entity.position.floored();
    let placed = 0;

    try {
      clearMovement();
      await bot.equip(blockItem, 'hand');
      const wallCoords = [
        new Vec3(2, 0, 0), new Vec3(-2, 0, 0), new Vec3(0, 0, 2), new Vec3(0, 0, -2),
        new Vec3(2, 1, 0), new Vec3(-2, 1, 0), new Vec3(0, 1, 2), new Vec3(0, 1, -2),
        new Vec3(2, 0, 1), new Vec3(2, 0, -1), new Vec3(-2, 0, 1), new Vec3(-2, 0, -1)
      ];

      for (const off of wallCoords) {
        if (taskStateRef.isInterrupted()) break;
        const p = center.plus(off);
        const space = bot.blockAt(p);
        const below = bot.blockAt(p.offset(0, -1, 0));
        if (isBlockPassable(space) && below && !isBlockPassable(below)) {
          try {
            await bot.placeBlock(below, new Vec3(0, 1, 0));
            placed++;
          } catch {}
        }
      }

      evo.recordExperience({
        skill: 'building',
        situation: { task: 'shelter', blocksPlaced: placed },
        actionParams: [0.8, 0.7, 0.8, 0.8],
        success: placed >= 4,
        reward: placed >= 4 ? 1.1 : -0.3,
        resourcesUsed: placed,
        agentSlot
      });
      return placed >= 4;
    } catch {
      return false;
    }
  }

  // ========================================
  // SMART ANTI-STUCK RECOVERY
  // ========================================

  function isSafeToDigBlock(block) {
    if (!block || !mcData) return false;
    if (PROTECTED_STRUCTURE_BLOCKS.includes(block.name)) return false;
    if (['bedrock', 'water', 'lava', 'flowing_lava', 'flowing_water', 'obsidian', 'crying_obsidian'].includes(block.name)) return false;

    const offsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0), new Vec3(0, -1, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];
    for (const off of offsets) {
      const n = bot.blockAt(block.position.plus(off));
      if (n && (n.name === 'lava' || n.name === 'flowing_lava')) return false;
    }
    return true;
  }

  async function clearSoftFoliageAroundBot() {
    if (!bot.entity) return false;
    const pos = bot.entity.position.floored();
    let cleared = 0;
    for (const dy of [0, 1, 2]) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const blk = bot.blockAt(pos.offset(dx, dy, dz));
        if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && SOFT_OBSTRUCTION_BLOCKS.has(blk.name)) {
          try {
            isActivelyDigging = true;
            await bot.dig(blk);
            cleared++;
            if (cleared >= 3) return true;
          } catch {} finally {
            isActivelyDigging = false;
          }
        }
      }
    }
    return cleared > 0;
  }

  async function tryPillarUpEscape() {
    if (!bot.entity) return false;
    const blockItem = getBestItem(BUILD_BLOCKS);
    if (!blockItem) return false;
    const pos = bot.entity.position.floored();
    const head2 = bot.blockAt(pos.offset(0, 2, 0));
    if (head2 && !isBlockPassable(head2)) return false;
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (!below || isBlockPassable(below)) return false;

    try {
      await bot.equip(blockItem, 'hand');
      bot.setControlState('jump', true);
      await sleep(160);
      await bot.placeBlock(below, new Vec3(0, 1, 0));
      bot.setControlState('jump', false);
      return true;
    } catch {
      try { bot.setControlState('jump', false); } catch {}
      return false;
    }
  }

  async function navigateRecoveryGoal(goal, timeoutMs = 8000) {
    if (!bot.entity || !bot.pathfinder || !goal) return false;
    useNavigationMovements();
    setGoal(goal, false);
    const start = Date.now();
    let lastPos = bot.entity.position.clone();
    let lastProgress = start;

    try {
      while (Date.now() - start < timeoutMs) {
        if (!bot.entity) return false;
        try {
          if (typeof goal.isEnd === 'function' && goal.isEnd(bot.entity.position.floored())) return true;
        } catch {}
        await sleep(250);
        const current = bot.entity.position;
        if (Math.hypot(current.x - lastPos.x, current.z - lastPos.z) >= 0.25) {
          lastPos = current.clone();
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > 1800) {
          return false;
        }
      }
      return false;
    } finally {
      if (bot.pathfinder.goal === goal) setGoal(null);
      try { bot.clearControlStates(); } catch {}
      useNavigationMovements();
    }
  }

  async function recoverFromStuck() {
    if (!bot.entity || recoveringFromStuck || Date.now() - lastUnstuckTime < 2500) return false;
    recoveringFromStuck = true;
    lastUnstuckTime = Date.now();
    unstuckAttempts++;
    const origin = bot.entity.position.floored();
    log(`Smart unstuck recovery (#${unstuckAttempts})`);

    try {
      if (taskStateRef.isRunning() && !taskStateRef.isInterrupted()) {
        await taskStateRef.interrupt('Movement watchdog: stuck');
      } else {
        try { bot.collectBlock?.cancelTask(); } catch {}
        try { bot.stopDigging(); } catch {}
        clearMovement();
      }

      if (await clearSoftFoliageAroundBot()) {
        stuckTicks = 0;
        lastProgressPos = bot.entity.position.clone();
        return true;
      }

      const side = Math.random() > 0.5 ? 'left' : 'right';
      bot.setControlState('back', true);
      bot.setControlState(side, true);
      bot.setControlState('jump', true);
      await sleep(360);
      bot.setControlState('back', false);
      bot.setControlState(side, false);
      bot.setControlState('jump', false);

      if (bot.entity.position.distanceTo(origin) > 0.7) {
        unstuckAttempts = 0;
        stuckTicks = 0;
        lastProgressPos = bot.entity.position.clone();
        return true;
      }

      const candidates = [];
      const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const radius of [2, 3, 5]) {
        for (const [dx, dz] of directions) {
          for (const dy of [0, 1, -1]) {
            const x = origin.x + dx * radius;
            const y = origin.y + dy;
            const z = origin.z + dz * radius;
            const feet = bot.blockAt(new Vec3(x, y, z));
            const head = bot.blockAt(new Vec3(x, y + 1, z));
            const floor = bot.blockAt(new Vec3(x, y - 1, z));
            if (isBlockPassable(feet) && isBlockPassable(head) && isBlockSolidFloor(floor)) {
              candidates.push({ x, y, z, score: radius + Math.abs(dy) * 2 });
            }
          }
        }
        if (candidates.length) break;
      }

      candidates.sort((a, b) => a.score - b.score);
      for (const candidate of candidates.slice(0, 5)) {
        if (await navigateRecoveryGoal(new GoalNear(candidate.x, candidate.y, candidate.z, 1), 5000)) {
          unstuckAttempts = 0;
          stuckTicks = 0;
          lastProgressPos = bot.entity.position.clone();
          return true;
        }
      }

      if (await tryPillarUpEscape()) {
        stuckTicks = 0;
        lastProgressPos = bot.entity.position.clone();
        return true;
      }

      for (const dir of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
        const wallHead = bot.blockAt(origin.plus(dir).offset(0, 1, 0));
        const wallFeet = bot.blockAt(origin.plus(dir));
        const naturalBlocks = new Set(['dirt', 'grass_block', 'sand', 'gravel', 'stone', 'cobblestone', 'netherrack', 'deepslate']);
        if (wallHead && naturalBlocks.has(wallHead.name) && isSafeToDigBlock(wallHead)) {
          isActivelyDigging = true;
          try {
            await equipBestPickaxe();
            await bot.dig(wallHead);
            if (wallFeet && naturalBlocks.has(wallFeet.name) && isSafeToDigBlock(wallFeet)) await bot.dig(wallFeet);
            bot.setControlState('forward', true);
            await sleep(450);
            bot.setControlState('forward', false);
            return true;
          } catch {} finally {
            isActivelyDigging = false;
          }
        }
      }

      blacklistColumn(origin, 35000);
      evo.recordExperience({
        skill: 'parkour',
        situation: { stuckAt: { x: origin.x, y: origin.y, z: origin.z }, attempts: unstuckAttempts },
        actionParams: [0.3, 0.3, 0.8, 0.8],
        success: false,
        reward: -0.65,
        evidence: 'stuck_recovery_failed',
        stateVector: buildStateVector(),
        agentSlot
      });
      return false;
    } finally {
      recoveringFromStuck = false;
      useNavigationMovements();
    }
  }

  function movementWatchdogTick() {
    if (!bot.entity || !bot.pathfinder) return;

    const now = Date.now();
    for (const [key, until] of failedBlockPositions.entries()) if (now > until) failedBlockPositions.delete(key);
    for (const [key, until] of failedColumns.entries()) if (now > until) failedColumns.delete(key);

    monitorTraps();
    if (avoidOwnTraps()) return;
    if (recoveringFromStuck || isActivelyDigging || dodgeRunning) return;

    if (bot.entity.isInWater) bot.setControlState('jump', true);
    const goal = bot.pathfinder.goal;
    if (!goal) {
      lastProgressPos = bot.entity.position.clone();
      stuckTicks = 0;
      return;
    }

    const inCloseCombat = Boolean(
      combatTarget && combatTarget.isValid !== false &&
      combatTarget.position.distanceTo(bot.entity.position) <= 4.2
    );
    if (inCloseCombat) {
      lastProgressPos = bot.entity.position.clone();
      stuckTicks = 0;
      return;
    }

    try {
      if (typeof goal.isEnd === 'function' && goal.isEnd(bot.entity.position.floored())) {
        lastProgressPos = bot.entity.position.clone();
        stuckTicks = 0;
        return;
      }
    } catch {}

    const current = bot.entity.position;
    if (!lastProgressPos) lastProgressPos = current.clone();
    const moved = Math.hypot(current.x - lastProgressPos.x, current.z - lastProgressPos.z) +
                  Math.abs(current.y - lastProgressPos.y) * 0.5;
    if (moved >= 0.22) {
      lastProgressPos = current.clone();
      stuckTicks = 0;
      unstuckAttempts = 0;
      return;
    }

    stuckTicks++;
    if (stuckTicks >= 7) {
      stuckTicks = 0;
      lastProgressPos = current.clone();
      recoverFromStuck().catch(err => log(`Recovery error: ${err.message}`));
    }
  }

  // ========================================
  // RELIABLE MINING, CRAFTING & ITEM PICKUP
  // ========================================

  async function pickupNearbyDrops(maxDist = 7.0) {
    if (!bot.entity) return false;
    let pickedAny = false;
    for (let i = 0; i < 3 && !taskStateRef.isInterrupted(); i++) {
      const drop = findNearestDrop(maxDist);
      if (!drop) break;
      const targetPos = drop.position.clone();
      const reached = await moveToGoal(
        new GoalNear(Math.floor(targetPos.x), Math.floor(targetPos.y), Math.floor(targetPos.z), 1),
        2800,
        false
      );
      // Step directly onto drop magnet radius (~1 block) if entity still exists
      if (drop.isValid !== false && bot.entity.position.distanceTo(targetPos) <= 2.4) {
        try {
          await bot.lookAt(targetPos.offset(0, 0.2, 0), false);
          bot.setControlState('forward', true);
          await sleep(260);
          bot.setControlState('forward', false);
        } catch {}
      }
      if (reached || drop.isValid === false) pickedAny = true;
      await sleep(100);
    }
    return pickedAny;
  }

  async function moveToGoal(goal, timeoutMs = 10000, allowDig = false) {
    if (!bot.entity || !bot.pathfinder || !goal) return false;
    if (allowDig) useMiningMovements();
    else useNavigationMovements();
    setGoal(goal, false);

    const started = Date.now();
    let lastProgressAt = started;
    let lastPos = bot.entity.position.clone();
    let replans = 0;
    let reachedEvent = false;
    const onReached = () => { reachedEvent = true; };
    bot.on('goal_reached', onReached);

    const isReached = () => {
      if (!bot.entity) return false;
      if (reachedEvent) return true;
      try {
        if (typeof goal.isEnd === 'function' && goal.isEnd(bot.entity.position.floored())) return true;
      } catch {}
      return false;
    };

    try {
      while (Date.now() - started < timeoutMs) {
        if (taskStateRef.isInterrupted() || !bot.entity) return false;
        if (isReached()) return true;

        await sleep(250);
        const current = bot.entity.position;
        if (Math.hypot(current.x - lastPos.x, current.z - lastPos.z) >= 0.18) {
          lastPos = current.clone();
          lastProgressAt = Date.now();
        }

        const idle = !bot.pathfinder.isMoving() && !bot.pathfinder.isMining();
        if (idle && Date.now() - lastProgressAt > 3600) {
          if (replans < 1) {
            replans++;
            lastProgressAt = Date.now();
            setGoal(goal, false);
          } else {
            return false;
          }
        } else if (Date.now() - lastProgressAt > 7000) {
          return false;
        }
      }
      return isReached();
    } finally {
      bot.removeListener('goal_reached', onReached);
      if (bot.pathfinder.goal === goal) setGoal(null);
      if (!combatTarget && !bot.pathfinder?.goal) {
        try { bot.clearControlStates(); } catch {}
      }
      useNavigationMovements();
    }
  }

  async function collectBlockSafely(block, timeoutMs = 18000) {
    if (!block || !bot.entity) return false;
    activeSkillContext = 'survival';
    if (!isSafeToDigBlock(block) && block.name !== 'obsidian') {
      throw new Error(`Refusing unsafe target block: ${block.name}`);
    }

    const knowledge = inspectBlockKnowledge(block);
    if (knowledge && !knowledge.harvestableWithCurrent) {
      blacklistBlockPos(block.position, 20000);
      throw new Error(`Need ${knowledge.minTierName} ${knowledge.bestToolCategory} before mining ${block.name}`);
    }

    const releaseClaim = claimResourcePosition(block.position, Math.max(timeoutMs + 15000, 30000));
    if (releaseClaim === null) throw new Error('Resource claimed by teammate');

    try {
      let currentBlock = bot.blockAt(block.position);
      if (!currentBlock || currentBlock.name !== block.name) return false;

      const dist = currentBlock.position.distanceTo(bot.entity.position);
      if (dist > 4.2) {
        const reached = await moveToGoal(
          new GoalGetToBlock(currentBlock.position.x, currentBlock.position.y, currentBlock.position.z),
          Math.min(20000, timeoutMs + 5000),
          false
        );
        if (!reached && currentBlock.position.distanceTo(bot.entity.position) > 4.8) {
          const reachedDig = await moveToGoal(
            new GoalGetToBlock(currentBlock.position.x, currentBlock.position.y, currentBlock.position.z),
            9000,
            true
          );
          if (!reachedDig && currentBlock.position.distanceTo(bot.entity.position) > 4.8) {
            blacklistBlockPos(currentBlock.position, 45000);
            blacklistColumn(currentBlock.position, 45000);
            throw new Error('No safe path to target');
          }
        }
      }

      if (taskStateRef.isInterrupted()) return false;
      currentBlock = bot.blockAt(block.position);
      if (!currentBlock || currentBlock.name !== block.name) return false;

      await equipBestToolForBlock(currentBlock);
      await bot.lookAt(currentBlock.position.offset(0.5, 0.5, 0.5), true);
      const beforeInv = snapshotInventoryCounts();
      const startHp = bot.health;
      const digStartAt = Date.now();
      const usedToolName = bot.heldItem?.name || 'hand';

      isActivelyDigging = true;
      try {
        await withTimeout(bot.dig(currentBlock), Math.min(10000, timeoutMs), 'dig');
        await sleep(280);
        await pickupNearbyDrops(7.0);
        const afterInv = snapshotInventoryCounts();
        learnFromBlockCollection({
          blockName: block.name,
          usedToolName,
          digTimeMs: Date.now() - digStartAt,
          beforeInv,
          afterInv,
          hpDelta: (bot.health || startHp) - startHp
        });
        return true;
      } catch (error) {
        try { bot.stopDigging(); } catch {}
        blacklistBlockPos(currentBlock.position, 45000);
        blacklistColumn(currentBlock.position, 45000);
        throw error;
      } finally {
        isActivelyDigging = false;
      }
    } finally {
      try { releaseClaim(); } catch {}
      useNavigationMovements();
    }
  }

  async function gatherWood(targetLogs = 6) {
    if (getTotalWoodLogs() >= targetLogs) return true;
    const stateVector = buildStateVector();
    const actionParams = evo.decideSkill('survival', stateVector, null, agentSlot);
    let gatheredAny = false;

    for (let attempt = 0; attempt < 3 && getTotalWoodLogs() < targetLogs && !taskStateRef.isInterrupted(); attempt++) {
      let block = findBlockByNames(LOG_NAMES, 28, true, true);
      if (!block) block = findBlockByNames(LOG_NAMES, 42, false, false);
      if (!block) {
        await explore();
        break;
      }

      memory.resources.wood = {
        x: Math.floor(block.position.x),
        y: Math.floor(block.position.y),
        z: Math.floor(block.position.z)
      };
      saveMemory();

      await equipBestAxe();
      try {
        const ok = await collectBlockSafely(block, 10000);
        if (ok) {
          gatheredAny = true;
          for (let dy = 1; dy <= 4; dy++) {
            if (taskStateRef.isInterrupted() || getTotalWoodLogs() >= targetLogs) break;
            const above = bot.blockAt(block.position.offset(0, dy, 0));
            if (above && LOG_NAMES.includes(above.name) && above.position.distanceTo(bot.entity.position) <= 4.6) {
              const beforeInv = snapshotInventoryCounts();
              const digStart = Date.now();
              isActivelyDigging = true;
              try {
                await equipBestToolForBlock(above);
                await bot.dig(above);
                await pickupNearbyDrops(6.5);
                learnFromBlockCollection({
                  blockName: above.name,
                  usedToolName: bot.heldItem?.name || 'hand',
                  digTimeMs: Date.now() - digStart,
                  beforeInv,
                  afterInv: snapshotInventoryCounts(),
                  hpDelta: 0
                });
              } catch {} finally {
                isActivelyDigging = false;
              }
            }
          }
        }
      } catch (err) {
        log(`Wood attempt failed: ${err.message}`);
        try { blacklistColumn(block.position, 45000); } catch {}
      }
    }

    const success = gatheredAny || getTotalWoodLogs() >= targetLogs;
    evo.recordExperience({
      skill: 'survival',
      situation: { task: 'gather_wood', logsAfter: getTotalWoodLogs() },
      actionParams,
      success,
      reward: success ? 0.9 : -0.45,
      evidence: success ? 'wood_collected' : 'wood_failed',
      stateVector,
      agentSlot,
      metricUpdates: success ? { resourcesGathered: 1 } : null
    });
    if (!success) requestSwarmResourceHelp('wood', 4, 1);
    return success;
  }

  function isCraftOnCooldown(name) {
    const until = craftCooldowns.get(name);
    return Boolean(until && Date.now() < until);
  }

  async function clearInventoryCursor() {
    try {
      if (bot.inventory.selectedItem) {
        const empty = bot.inventory.firstEmptyInventorySlot();
        if (empty !== null && empty !== undefined) {
          await bot.clickWindow(empty, 0, 0);
        }
      }
    } catch {}
  }

  async function craftItem(name, amount = 1, needsTable = true) {
    if (!mcData || isCraftOnCooldown(name)) return false;
    const item = mcData.itemsByName[name];
    if (!item) return false;

    let table = null;
    if (needsTable) {
      table = await ensureCraftingTable();
      if (!table) return false;
    }

    const recipes = bot.recipesFor(item.id, null, 1, table);
    if (!recipes.length) return false;

    const beforeCount = inventoryCount(name);
    const winTarget = !table && typeof bot.inventory?.rawListeners === 'function' ? bot.inventory : null;
    const prevUpdateListeners = winTarget ? new Set(winTarget.rawListeners('updateSlot')) : null;
    try {
      await clearInventoryCursor();
      for (let i = 0; i < amount; i++) {
        const currentRecipes = bot.recipesFor(item.id, null, 1, table);
        if (!currentRecipes.length) break;
        const startIterCount = inventoryCount(name);

        // Start craft, and exit immediately as soon as real inventory receives the item (~150-300ms)
        let craftErr = null;
        const craftPromise = bot.craft(currentRecipes[0], 1, table).catch(e => { craftErr = e; });
        const deadline = Date.now() + 1800;
        while (Date.now() < deadline) {
          if (inventoryCount(name) > startIterCount) break;
          if (craftErr) break;
          await sleep(100);
        }
        // Pull output out of slot 0 if 26.1 left it in crafting result slot
        if (bot.currentWindow?.slots?.[0]?.name === name || bot.inventory.slots[0]?.name === name) {
          try { await withTimeout(bot.clickWindow(0, 0, 1), 600, 'takeCraftOut'); } catch {}
        }
        await Promise.race([craftPromise, sleep(120)]);
      }
    } catch (err) {
      log(`Craft notice (${name}): ${err.message}`);
    } finally {
      await clearInventoryCursor();
      try { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch {}
      // Remove any orphaned updateSlot listeners left behind by timed-out 26.1 bot.craft() calls
      if (winTarget && prevUpdateListeners) {
        for (const fn of winTarget.rawListeners('updateSlot')) {
          if (!prevUpdateListeners.has(fn)) winTarget.removeListener('updateSlot', fn);
        }
      }
    }

    for (let w = 0; w < 4 && inventoryCount(name) <= beforeCount; w++) {
      await sleep(120);
    }

    const afterCount = inventoryCount(name);
    if (afterCount > beforeCount) {
      craftCooldowns.delete(name);
      log(`Crafted ${afterCount - beforeCount}x ${name} (total=${afterCount})`);
      classifyDiscoveredItem(name);
      evo.recordExperience({
        skill: 'survival',
        situation: { task: `craft_${name}`, total: afterCount },
        actionParams: [0.5, 0.7, 0.9, 0.5],
        success: true,
        reward: 1.0,
        evidence: `crafted_${name}`,
        stateVector: buildStateVector(),
        agentSlot,
        metricUpdates: { itemsCrafted: 1 }
      });
      return true;
    }

    craftCooldowns.set(name, Date.now() + 1500);
    return false;
  }

  async function craftPlanksFromLogs() {
    if (!mcData) return false;
    const logs = getAllInventoryItems().filter(i => LOG_NAMES.includes(i.name));
    if (!logs.length) return false;
    // Prefer log matching existing planks so planks stack properly instead of fragmenting
    logs.sort((a, b) => b.count - a.count);
    for (const logItem of logs) {
      const plankName = logItem.name.replace('_log', '_planks').replace('_stem', '_planks');
      if (isCraftOnCooldown(plankName)) continue;
      const ok = await craftItem(plankName, Math.min(logItem.count, 3), false);
      if (ok) return true;
    }
    return false;
  }

  async function craftSticks(min = 4) {
    if (!mcData) return false;
    if (inventoryCount('stick') >= min) return true;
    const stickItem = mcData.itemsByName.stick;
    if (!stickItem) return false;
    if (!bot.recipesFor(stickItem.id, null, 1, null).length) {
      await craftPlanksFromLogs();
    }
    if (!bot.recipesFor(stickItem.id, null, 1, null).length) return false;
    return await craftItem('stick', 1, false);
  }

  async function placeBlockNearby(itemName) {
    if (!bot.entity || !mcData) return null;
    const item = getBestItem([itemName]);
    if (!item) return null;
    const botPos = bot.entity.position.floored();
    const offsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      new Vec3(1, 0, 1), new Vec3(-1, 0, -1),
      new Vec3(1, 0, -1), new Vec3(-1, 0, 1)
    ];

    for (const off of offsets) {
      const p = botPos.plus(off);
      const space = bot.blockAt(p);
      const ground = bot.blockAt(p.offset(0, -1, 0));
      if (!space || !ground) continue;
      if (isBlockPassable(space) && !isBlockPassable(ground) && !HAZARD_BLOCKS.has(ground.name)) {
        try {
          clearMovement();
          if (space.name !== 'air' && space.name !== 'cave_air') {
            isActivelyDigging = true;
            try { await bot.dig(space); } finally { isActivelyDigging = false; }
          }
          await bot.equip(item, 'hand');
          await bot.placeBlock(ground, new Vec3(0, 1, 0));
          await sleep(220);
          const placed = bot.blockAt(p);
          if (placed && placed.name === itemName) {
            registerSharedStation(itemName, placed.position);
            return placed;
          }
        } catch {}
      }
    }
    return null;
  }

  async function findOrPlaceStation(stationName, craftAmount = 1, needsTable = false) {
    if (!mcData || !bot.entity) return null;
    const stId = mcData.blocksByName[stationName]?.id;
    let block = stId !== undefined ? bot.findBlock({ matching: stId, maxDistance: 20 }) : null;

    if (!block) {
      const shared = ensureSwarmContext().stations[stationName];
      if (shared) {
        const sPos = new Vec3(shared.x, shared.y, shared.z);
        if (sPos.distanceTo(bot.entity.position) <= 28) {
          const check = bot.blockAt(sPos);
          if (check && check.name === stationName) block = check;
        }
      }
    }

    if (block) {
      if (block.position.distanceTo(bot.entity.position) > 3.6) {
        await moveToGoal(new GoalNear(block.position.x, block.position.y, block.position.z, 2), 8000, true);
      }
      if (block.position.distanceTo(bot.entity.position) <= 4.5) {
        registerSharedStation(stationName, block.position);
        return block;
      }
    }

    if (inventoryCount(stationName) === 0) {
      if (stationName === 'crafting_table') {
        if (getTotalPlanks() < 4) await craftPlanksFromLogs();
        if (getTotalPlanks() >= 4) await craftItem('crafting_table', 1, false);
      } else if (stationName === 'furnace' && inventoryCount('cobblestone') >= 8) {
        await craftItem('furnace', craftAmount, needsTable);
      } else if (stationName === 'smithing_table' && inventoryCount('iron_ingot') >= 2 && getTotalPlanks() >= 4) {
        await craftItem('smithing_table', 1, true);
      }
    }

    if (inventoryCount(stationName) > 0) {
      return await placeBlockNearby(stationName);
    }
    return null;
  }

  async function ensureCraftingTable() {
    return await findOrPlaceStation('crafting_table', 1, false);
  }

  async function ensureFurnace() {
    return await findOrPlaceStation('furnace', 1, true);
  }

  async function ensureSmithingTable() {
    return await findOrPlaceStation('smithing_table', 1, true);
  }

  async function smeltItem(inputName, maxCount = 8) {
    const inputItem = getBestItem([inputName]);
    if (!inputItem) return false;
    const count = Math.min(inputItem.count, maxCount);
    const fuelItem = chooseSmartFuel(count);
    if (!fuelItem) return false;
    const furnaceBlock = await ensureFurnace();
    if (!furnaceBlock) return false;

    let furnace = null;
    try {
      furnace = await withTimeout(bot.openFurnace(furnaceBlock), 4000, 'openFurnace');
      if (!furnace.fuelItem()) {
        await furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, Math.max(1, Math.ceil(count / 2))));
      }
      if (!furnace.inputItem()) {
        await furnace.putInput(inputItem.type, null, count);
      }

      const deadline = Date.now() + Math.min(35000, count * 10500);
      while (Date.now() < deadline && !taskStateRef.isInterrupted() && bot.entity) {
        await sleep(1000);
        const out = furnace.outputItem();
        const inp = furnace.inputItem();
        if (out && (!inp || out.count >= count)) {
          await furnace.takeOutput();
          break;
        }
      }
      if (furnace.outputItem()) await furnace.takeOutput();
      return true;
    } catch {
      return false;
    } finally {
      try { if (furnace) furnace.close(); } catch {}
    }
  }

  // ========================================
  // SYSTEMATIC MINING (STONE -> IRON -> DIAMOND -> OBSIDIAN -> DEBRIS)
  // ========================================

  async function safeStepMineDown(targetY = 32, targetOreNames = null) {
    if (!bot.entity) return false;
    if (!hasToolTierOrBetter(PICKAXE_NAMES, 'wooden_pickaxe')) return false;
    const pos = bot.entity.position.floored();
    if (pos.y <= targetY) {
      return await horizontalBranchMine(
        targetOreNames || ['iron_ore', 'deepslate_iron_ore', 'diamond_ore', 'deepslate_diamond_ore', 'ancient_debris']
      );
    }

    await equipBestPickaxe();
    const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
    const dir = dirs[(agentSlot + Math.floor(Date.now() / 12000)) % dirs.length];
    let mined = 0;

    isActivelyDigging = true;
    try {
      for (let step = 0; step < 3 && !taskStateRef.isInterrupted(); step++) {
        const cur = bot.entity.position.floored();
        if (cur.y <= targetY) break;
        const aheadCeiling = cur.plus(dir).offset(0, 2, 0);
        const aheadTop = cur.plus(dir).offset(0, 1, 0);
        const aheadMid = cur.plus(dir);
        const aheadLow = cur.plus(dir).offset(0, -1, 0);
        const floorCheck = bot.blockAt(cur.plus(dir).offset(0, -2, 0));
        if (!floorCheck || HAZARD_BLOCKS.has(floorCheck.name) || floorCheck.name === 'water' || floorCheck.name === 'flowing_water') break;

        for (const tp of [aheadCeiling, aheadTop, aheadMid, aheadLow]) {
          if (taskStateRef.isInterrupted()) break;
          const blk = bot.blockAt(tp);
          if (!blk || isBlockPassable(blk)) continue;
          if (!isSafeToDigBlock(blk)) return mined > 0;
          await equipBestToolForBlock(blk);
          const beforeInv = snapshotInventoryCounts();
          const t0 = Date.now();
          await withTimeout(bot.dig(blk), 6000, 'dig');
          mined++;
          learnFromBlockCollection({
            blockName: blk.name,
            usedToolName: bot.heldItem?.name || 'hand',
            digTimeMs: Date.now() - t0,
            beforeInv,
            afterInv: snapshotInventoryCounts(),
            hpDelta: 0
          });
        }

        const nextStand = cur.plus(dir).offset(0, -1, 0);
        const stepped = await moveToGoal(new GoalNear(nextStand.x, nextStand.y, nextStand.z, 1), 2600, false);
        if (!stepped && bot.entity) {
          try {
            await bot.lookAt(nextStand.offset(0.5, 0.5, 0), false);
            bot.setControlState('forward', true);
            await sleep(420);
            bot.setControlState('forward', false);
          } catch {}
        }
        await sleep(220);
        await pickupNearbyDrops(6.5);
      }
      return mined > 0;
    } catch {
      return mined > 0;
    } finally {
      try { bot.setControlState('forward', false); } catch {}
      isActivelyDigging = false;
      useNavigationMovements();
    }
  }

  async function horizontalBranchMine(oreNames = []) {
    if (!bot.entity) return false;
    await equipBestPickaxe();
    const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
    const dir = dirs[(Math.floor(Date.now() / 15000) + agentSlot) % dirs.length];
    let mined = 0;

    isActivelyDigging = true;
    try {
      for (let step = 0; step < 5 && !taskStateRef.isInterrupted(); step++) {
        if (oreNames.length) {
          const ore = findBlockByNames(oreNames, 6, false, false);
          if (ore) {
            isActivelyDigging = false;
            return await collectBlockSafely(ore, 12000);
          }
        }
        const cur = bot.entity.position.floored();
        const floorAhead = bot.blockAt(cur.plus(dir).offset(0, -1, 0));
        if (!floorAhead || HAZARD_BLOCKS.has(floorAhead.name)) break;

        for (const tp of [cur.plus(dir).offset(0, 1, 0), cur.plus(dir)]) {
          const blk = bot.blockAt(tp);
          if (!blk || isBlockPassable(blk)) continue;
          if (!isSafeToDigBlock(blk)) return mined > 0;
          await equipBestToolForBlock(blk);
          await withTimeout(bot.dig(blk), 6000, 'dig');
          mined++;
        }
        const walkPos = cur.plus(dir);
        await moveToGoal(new GoalNear(walkPos.x, walkPos.y, walkPos.z, 0), 3200, false);
        await pickupNearbyDrops(6.5);
      }
      return mined > 0;
    } catch {
      return mined > 0;
    } finally {
      isActivelyDigging = false;
      useNavigationMovements();
    }
  }

  async function gatherCobblestoneSmart() {
    if (!hasToolTierOrBetter(PICKAXE_NAMES, 'wooden_pickaxe')) return false;
    const stateVector = buildStateVector();
    const actionParams = evo.decideSkill('survival', stateVector, null, agentSlot);
    let success = false;

    try {
      const stone = findBlockByNames(['stone', 'cobblestone'], 26, true, true);
      await equipBestPickaxe();
      if (stone) {
        success = await collectBlockSafely(stone, 12000);
      } else {
        success = await safeStepMineDown(Math.floor(bot.entity.position.y) - 6, ['stone', 'cobblestone', 'coal_ore', 'iron_ore']);
      }
      evo.recordExperience({
        skill: 'survival',
        situation: { task: 'gather_cobblestone', cobblestone: inventoryCount('cobblestone') },
        actionParams,
        success,
        reward: success ? 0.85 : -0.4,
        evidence: success ? 'cobblestone_collected' : 'cobblestone_failed',
        stateVector,
        agentSlot,
        metricUpdates: success ? { resourcesGathered: 1 } : null
      });
      return success;
    } catch {
      try {
        return await safeStepMineDown(bot.entity.position.y - 6, ['stone', 'cobblestone', 'coal_ore', 'iron_ore']);
      } catch {
        return false;
      }
    }
  }

  async function gatherResourceByNames(names, tool = 'pickaxe', fallbackDepth = null) {
    const stateVector = buildStateVector();
    const actionParams = evo.decideSkill('survival', stateVector, null, agentSlot);

    let block = findBlockByNames(names, 28, true, true);
    if (!block) block = findBlockByNames(names, 36, false, false);
    if (!block) {
      if (fallbackDepth !== null) {
        return await safeStepMineDown(fallbackDepth, names);
      }
      return false;
    }

    try {
      const k = inspectBlockKnowledge(block);
      if (k && !k.harvestableWithCurrent) {
        log(`[KNOWLEDGE] Skipping ${block.name}: need ${k.minTierName} ${k.bestToolCategory}`);
        return false;
      }
      if (tool === 'pickaxe') await equipBestPickaxe();
      else if (tool === 'axe') await equipBestAxe();
      const success = await collectBlockSafely(block, 18000);
      evo.recordExperience({
        skill: 'survival',
        situation: { task: 'gather_resource', resource: block.name },
        actionParams,
        success,
        reward: success ? 1.15 : -0.4,
        evidence: success ? `mined_${block.name}` : 'resource_failed',
        stateVector,
        agentSlot,
        metricUpdates: success ? { resourcesGathered: 1 } : null
      });
      return success;
    } catch {
      return false;
    }
  }

  // ========================================
  // OBSIDIAN, NETHER PORTAL & NETHERITE TECH TREE
  // ========================================

  async function fillWaterBucketIfNearby() {
    const emptyBucket = getBestItem(['bucket']);
    if (!emptyBucket) return false;
    const water = findBlockByNames(['water'], 32, true, false);
    if (!water) return false;
    await moveToGoal(new GoalNear(water.position.x, water.position.y, water.position.z, 2), 9000, false);
    if (water.position.distanceTo(bot.entity.position) <= 4.5) {
      try {
        await bot.equip(emptyBucket, 'hand');
        await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true);
        bot.activateItem();
        await sleep(300);
        return inventoryCount('water_bucket') > 0;
      } catch {}
    }
    return false;
  }

  async function obtainObsidianSmart() {
    await equipBestPickaxe();
    const naturalObs = findBlockByNames(['obsidian'], 32, false, false);
    if (naturalObs && inspectBlockKnowledge(naturalObs)?.harvestableWithCurrent) {
      return await collectBlockSafely(naturalObs, 25000);
    }

    if (inventoryCount('water_bucket') > 0) {
      const lava = findBlockByNames(['lava'], 28, false, true);
      if (lava) {
        const above = bot.blockAt(lava.position.offset(0, 1, 0));
        if (above && isBlockPassable(above)) {
          await moveToGoal(new GoalNear(lava.position.x, lava.position.y + 1, lava.position.z, 3), 10000, true);
          const waterBucket = getBestItem(['water_bucket']);
          if (waterBucket && lava.position.distanceTo(bot.entity.position) <= 4.5) {
            try {
              await bot.equip(waterBucket, 'hand');
              await bot.lookAt(lava.position.offset(0.5, 1.0, 0.5), true);
              bot.activateItem();
              await sleep(600);
              const bucket = getBestItem(['bucket']);
              if (bucket) {
                await bot.equip(bucket, 'hand');
                await bot.lookAt(lava.position.offset(0.5, 1.0, 0.5), true);
                bot.activateItem();
              }
              const obs = findBlockByNames(['obsidian'], 10, false, false);
              if (obs) return await collectBlockSafely(obs, 25000);
            } catch {}
          }
        }
      }
    }
    if (bot.entity.position.y > 11) {
      return await safeStepMineDown(10, ['diamond_ore', 'deepslate_diamond_ore', 'obsidian']);
    }
    await explore();
    return false;
  }

  async function buildAndLightNetherPortal() {
    if (!bot.entity || !mcData) return false;
    if (inventoryCount('obsidian') < 10) return false;

    const portalId = mcData.blocksByName.nether_portal?.id;
    const existingPortal = portalId ? bot.findBlock({ matching: portalId, maxDistance: 40 }) : null;
    if (existingPortal) {
      registerSharedStation('nether_portal', existingPortal.position);
      return true;
    }

    const base = bot.entity.position.floored().offset(2, 0, 0);
    const frameOffsets = [
      new Vec3(1, 0, 0), new Vec3(2, 0, 0),
      new Vec3(0, 1, 0), new Vec3(0, 2, 0), new Vec3(0, 3, 0),
      new Vec3(3, 1, 0), new Vec3(3, 2, 0), new Vec3(3, 3, 0),
      new Vec3(1, 4, 0), new Vec3(2, 4, 0)
    ];

    const interiorOffsets = [
      new Vec3(1, 1, 0), new Vec3(2, 1, 0),
      new Vec3(1, 2, 0), new Vec3(2, 2, 0),
      new Vec3(1, 3, 0), new Vec3(2, 3, 0)
    ];

    try {
      clearMovement();
      for (const off of interiorOffsets) {
        const blk = bot.blockAt(base.plus(off));
        if (blk && !isBlockPassable(blk) && isSafeToDigBlock(blk)) {
          await equipBestToolForBlock(blk);
          await bot.dig(blk);
        }
      }

      let placed = 0;
      for (const off of frameOffsets) {
        const targetPos = base.plus(off);
        const cur = bot.blockAt(targetPos);
        if (cur?.name === 'obsidian') { placed++; continue; }

        const dirs = [
          new Vec3(0, -1, 0), new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
          new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(0, 1, 0)
        ];
        for (const d of dirs) {
          const neighbor = bot.blockAt(targetPos.plus(d));
          if (neighbor && !isBlockPassable(neighbor)) {
            if (targetPos.distanceTo(bot.entity.position) > 4.2) {
              await moveToGoal(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3), 5000, false);
            }
            const item = getBestItem(['obsidian']);
            if (!item) break;
            await bot.equip(item, 'hand');
            await bot.placeBlock(neighbor, d.scaled(-1));
            placed++;
            await sleep(160);
            break;
          }
        }
      }

      const lighter = getBestItem(['flint_and_steel', 'fire_charge']);
      const bottomObs = bot.blockAt(base.offset(1, 0, 0));
      if (lighter && bottomObs?.name === 'obsidian') {
        await moveToGoal(new GoalNear(bottomObs.position.x, bottomObs.position.y + 1, bottomObs.position.z, 2), 6000, false);
        await bot.equip(lighter, 'hand');
        await bot.lookAt(bottomObs.position.offset(0.5, 1.0, 0.5), true);
        await bot.activateBlock(bottomObs);
        await sleep(500);
      }

      const litPortal = portalId ? bot.findBlock({ matching: portalId, maxDistance: 12 }) : null;
      if (litPortal) {
        registerSharedStation('nether_portal', litPortal.position);
        evo.recordAgentMilestone(agentSlot, 'nether_portal_lit', 4, 4.5);
        evo.recordExperience({
          skill: 'building',
          situation: { task: 'nether_portal_built' },
          actionParams: [0.9, 0.8, 0.9, 0.9],
          success: true,
          reward: 4.5,
          evidence: 'nether_portal_lit',
          stateVector: buildStateVector(),
          agentSlot,
          metricUpdates: { maxStageReached: 4 }
        });
        log('Nether Portal built and lit!');
        return true;
      }
      return placed >= 10;
    } catch (err) {
      log(`Portal build failed: ${err.message}`);
      return false;
    }
  }

  async function enterNetherPortal() {
    if (!mcData || bot.game?.dimension === 'the_nether') return true;
    const portalId = mcData.blocksByName.nether_portal?.id;
    let portalBlock = portalId ? bot.findBlock({ matching: portalId, maxDistance: 48 }) : null;

    if (!portalBlock) {
      const saved = ensureSwarmContext().stations.nether_portal || memory.portalPosition;
      if (saved) {
        await moveToGoal(new GoalNear(saved.x, saved.y, saved.z, 2), 15000, true);
        portalBlock = portalId ? bot.findBlock({ matching: portalId, maxDistance: 12 }) : null;
      }
    }
    if (!portalBlock) return false;

    const ok = await moveToGoal(new GoalNear(portalBlock.position.x, portalBlock.position.y, portalBlock.position.z, 0), 12000, false);
    if (ok) {
      await sleep(4500);
      return bot.game?.dimension === 'the_nether';
    }
    return false;
  }

  async function upgradeDiamondToNetheriteArmor() {
    if (!mcData || inventoryCount('netherite_ingot') === 0 || inventoryCount('netherite_upgrade_smithing_template') === 0) {
      return false;
    }

    const smithingBlock = await ensureSmithingTable();
    if (!smithingBlock) return false;

    let upgradedAny = false;
    for (const armorSlot of ARMOR_SLOTS) {
      if (inventoryCount('netherite_ingot') === 0 || inventoryCount('netherite_upgrade_smithing_template') === 0) break;
      const diamondName = `diamond${armorSlot.suffix}`;
      const netheriteName = `netherite${armorSlot.suffix}`;
      if (inventoryCount(netheriteName) > 0 || bot.inventory.slots[armorSlot.index]?.name === netheriteName) continue;

      if (bot.inventory.slots[armorSlot.index]?.name === diamondName) {
        try { await bot.unequip(armorSlot.slot); await sleep(200); } catch {}
      }
      if (inventoryCount(diamondName) === 0) continue;

      let win = null;
      try {
        win = await bot.openBlock(smithingBlock);
        const findWinItem = n => win.slots.find(s => s && s.slot >= win.inventoryStart && s.name === n);

        const tpl = findWinItem('netherite_upgrade_smithing_template');
        const base = findWinItem(diamondName);
        const ingot = findWinItem('netherite_ingot');
        if (!tpl || !base || !ingot) { win.close(); continue; }

        await bot.clickWindow(tpl.slot, 0, 0);
        await bot.clickWindow(0, 1, 0);
        if (bot.inventory.selectedItem) await bot.clickWindow(tpl.slot, 0, 0);

        await bot.clickWindow(base.slot, 0, 0);
        await bot.clickWindow(1, 0, 0);

        await bot.clickWindow(ingot.slot, 0, 0);
        await bot.clickWindow(2, 1, 0);
        if (bot.inventory.selectedItem) await bot.clickWindow(ingot.slot, 0, 0);

        await sleep(250);
        if (win.slots[3]?.name === netheriteName) {
          await bot.clickWindow(3, 0, 1);
          upgradedAny = true;
          log(`[MILESTONE] Upgraded ${diamondName} -> ${netheriteName}!`);
        }
      } catch (err) {
        log(`Smithing upgrade failed: ${err.message}`);
      } finally {
        try { if (win) win.close(); } catch {}
      }
    }

    if (upgradedAny) {
      await upgradeArmor();
      evo.recordAgentMilestone(agentSlot, 'netherite_armor_piece', 6, 8.0);
    }
    return upgradedAny;
  }

  async function searchNearbyChestsForTemplate() {
    if (!mcData || !bot.entity) return false;
    const chestId = mcData.blocksByName.chest?.id;
    const chests = chestId ? bot.findBlocks({ matching: chestId, maxDistance: 36, count: 6 }) : [];
    for (const cPos of chests) {
      if (isBlockBlacklisted(cPos)) continue;
      const blk = bot.blockAt(cPos);
      if (!blk) continue;
      await moveToGoal(new GoalNear(cPos.x, cPos.y, cPos.z, 2), 9000, true);
      let chest = null;
      try {
        chest = await withTimeout(bot.openChest(blk), 4000, 'openChest');
        const tpl = chest.containerItems().find(i => i.name === 'netherite_upgrade_smithing_template');
        const debris = chest.containerItems().find(i => i.name === 'ancient_debris' || i.name === 'netherite_scrap' || i.name === 'netherite_ingot');
        if (tpl) await chest.withdraw(tpl.type, null, tpl.count);
        if (debris) await chest.withdraw(debris.type, null, debris.count);
        if (tpl || debris) return true;
        blacklistBlockPos(cPos, 120000);
      } catch {} finally {
        try { if (chest) chest.close(); } catch {}
      }
    }
    return false;
  }

  async function explore() {
    if (!bot.entity) return false;
    activeSkillContext = 'exploration';
    const stateVector = buildStateVector();
    const [curiosity, , baseTether] = evo.decideSkill('exploration', stateVector, null, agentSlot);

    const x = Math.floor(bot.entity.position.x);
    const z = Math.floor(bot.entity.position.z);

    if (basePosition && bot.entity.position.distanceTo(basePosition) > 65 && baseTether > 0.65) {
      return await moveToGoal(new GoalXZ(Math.floor(basePosition.x), Math.floor(basePosition.z)), 8000);
    }

    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.floor(curiosity * 20);
    const targetX = Math.floor(x + Math.cos(angle) * dist);
    const targetZ = Math.floor(z + Math.sin(angle) * dist);
    const reached = await moveToGoal(new GoalXZ(targetX, targetZ), 10000, false);

    if (!taskStateRef.isInterrupted()) {
      evo.recordExperience({
        skill: 'exploration',
        situation: { targetX, targetZ },
        actionParams: [curiosity, 0.5, baseTether, 0.5],
        success: Boolean(reached),
        reward: reached ? 0.55 : -0.35,
        evidence: reached ? 'exploration_goal_reached' : 'exploration_path_failed',
        stateVector,
        agentSlot
      });
    }
    return Boolean(reached);
  }

  function hasFoodAnimalNearby(maxDist = 34) {
    if (!bot.entity) return false;
    return Boolean(bot.nearestEntity(e =>
      isPassiveFoodEntity(e) &&
      e.position.distanceTo(bot.entity.position) <= maxDist
    ));
  }

  async function huntAnimalForFood() {
    if (!bot.entity) return false;
    activeSkillContext = 'survival';
    lastHuntTime = Date.now();
    const animal = bot.nearestEntity(e =>
      isPassiveFoodEntity(e) &&
      e.position.distanceTo(bot.entity.position) <= 40
    );
    if (!animal) {
      await explore();
      return false;
    }

    const targetPos = animal.position.clone();
    await equipBestWeapon();
    combatTarget = animal;
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline && animal.isValid !== false && !taskStateRef.isInterrupted()) {
      await sleep(250);
    }
    stopCombat();
    await moveToGoal(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1), 2500, false);
    await pickupNearbyDrops(5.0);
    clearMovement();
    return getTotalRawMeat() > 0 || getTotalEdibleFood() > 0;
  }

  async function depositExcessToChest() {
    if (!mcData || !bot.entity || bot.inventory.items().length < 28) return false;
    const chestId = mcData.blocksByName.chest?.id;
    let chestBlock = chestId !== undefined ? bot.findBlock({ matching: chestId, maxDistance: 16 }) : null;
    if (!chestBlock) {
      if (inventoryCount('chest') === 0 && getTotalPlanks() >= 8) await craftItem('chest', 1, true);
      if (inventoryCount('chest') > 0) chestBlock = await placeBlockNearby('chest');
    }
    if (!chestBlock) return false;
    registerSharedStation('chest', chestBlock.position);
    if (chestBlock.position.distanceTo(bot.entity.position) > 4) {
      await moveToGoal(new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2), 8000, true);
    }

    let chest = null;
    try {
      chest = await withTimeout(bot.openChest(chestBlock), 4000, 'openChest');
      const keep = new Set([
        ...PICKAXE_NAMES, ...AXE_NAMES, ...SHOVEL_NAMES, ...SWORD_NAMES, ...FOOD_ITEMS,
        'shield', 'water_bucket', 'bucket', 'flint_and_steel', 'flint', 'coal', 'charcoal',
        'iron_ingot', 'gold_ingot', 'diamond', 'obsidian', 'ancient_debris',
        'netherite_scrap', 'netherite_ingot', 'netherite_upgrade_smithing_template',
        'crafting_table', 'furnace', 'smithing_table'
      ]);
      for (const item of bot.inventory.items()) {
        if (keep.has(item.name)) continue;
        if (item.name === 'cobblestone' && item.count <= 32) continue;
        try { await chest.deposit(item.type, null, item.count); } catch { break; }
      }
      return true;
    } catch {
      return false;
    } finally {
      try { if (chest) chest.close(); } catch {}
    }
  }

  // ========================================
  // PROGRESSION STAGES (1 -> 7) & GOAL PLANNER
  // ========================================

  function computeProgressionStage() {
    const hasStonePick = hasToolTierOrBetter(PICKAXE_NAMES, 'stone_pickaxe');
    const hasIronPick = hasToolTierOrBetter(PICKAXE_NAMES, 'iron_pickaxe');
    const hasDiamondPick = hasToolTierOrBetter(PICKAXE_NAMES, 'diamond_pickaxe');
    const hasShield = inventoryCount('shield') > 0 || bot.inventory.slots[45]?.name === 'shield';
    const portalKnown = Boolean(ensureSwarmContext().stations.nether_portal || memory.portalPosition);
    const inNether = bot.game?.dimension === 'the_nether';
    const netheritePieces = getNetheriteArmorCount();
    const hasEndItems = inventoryCount('blaze_rod') > 0 || inventoryCount('blaze_powder') > 0 || inventoryCount('ender_eye') > 0;

    let stage = 1;
    if (hasStonePick) stage = 2;
    if (hasIronPick && hasShield) stage = 3;
    if (hasDiamondPick) stage = 4;
    if (portalKnown || inNether || inventoryCount('ancient_debris') > 0 || inventoryCount('netherite_ingot') > 0) stage = 5;
    if (netheritePieces >= 1) stage = 6;
    if (netheritePieces >= 4 && hasEndItems) stage = 7;

    if (stage > (memory.stage || 1)) {
      evo.recordAgentMilestone(agentSlot, `stage_${stage}_reached`, stage, 2.5 + stage * 0.6);
    }

    state.stage = stage;
    memory.stage = Math.max(memory.stage || 1, stage);
    return stage;
  }

  function getProgressChecklistText() {
    const stage = computeProgressionStage();
    const hasIronPick = hasToolTierOrBetter(PICKAXE_NAMES, 'iron_pickaxe');
    const hasDiaPick = hasToolTierOrBetter(PICKAXE_NAMES, 'diamond_pickaxe');
    const portal = ensureSwarmContext().stations.nether_portal || memory.portalPosition;
    const nethArmor = getNetheriteArmorCount();
    return [
      `Stage ${stage}/7`,
      `IronPick:${hasIronPick ? 'Y' : 'N'}`,
      `DiaPick:${hasDiaPick ? 'Y' : 'N'}`,
      `Obsidian:${inventoryCount('obsidian')}/10`,
      `Portal:${portal ? 'LIT' : 'NO'}`,
      `Debris:${inventoryCount('ancient_debris')}`,
      `NethIngot:${inventoryCount('netherite_ingot')}`,
      `NethArmor:${nethArmor}/4`
    ].join(' | ');
  }

  function getTeamStatusText() {
    const sc = ensureSwarmContext();
    const role = getSwarmRole();
    const activeReqs = sc.requests.filter(r => r.expiresAt > Date.now()).length;
    const stations = Object.entries(sc.stations)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => `${k}(${v.x},${v.y},${v.z})`)
      .join(', ') || 'none';
    return `Role: ${role} | Active Help Reqs: ${activeReqs} | Stations: ${stations}`;
  }

  function selectDynamicSurvivalGoal() {
    computeProgressionStage();
    activeSkillContext = 'survival';
    const role = getSwarmRole();
    const vec = buildStateVector();
    const [, gatherPriority, craftPriority, shelterCaution] = evo.decideSkill('survival', vec, null, agentSlot);
    const isNight = bot.time?.timeOfDay >= 12541 && bot.time?.timeOfDay <= 23458;

    // 1. Food & Healing
    if ((bot.food <= 15 || bot.health <= 12) && getTotalEdibleFood() > 0) {
      return { name: 'eat_food', priority: 110, execute: () => eatFood(true) };
    }

    if (getTotalEdibleFood() < 3 && getTotalRawMeat() > 0 && hasFurnaceOrMaterials() && (inventoryCount('coal') > 0 || getTotalPlanks() >= 2)) {
      const raw = getBestItem(RAW_MEAT_ITEMS);
      if (raw) return { name: `cook_${raw.name}`, priority: 88, execute: () => smeltItem(raw.name, 4) };
    }

    if (
      bot.food < 15 &&
      getTotalEdibleFood() === 0 &&
      getTotalRawMeat() === 0 &&
      Date.now() - lastHuntTime > 20000 &&
      (bot.food <= 6 || hasFoodAnimalNearby(34))
    ) {
      requestSwarmResourceHelp('food', 2, 2);
      return { name: 'hunt_food', priority: 84, execute: huntAnimalForFood };
    }

    if (bot.inventory.items().length < 33 && findNearestDrop(9)) {
      return { name: 'collect_dropped_items', priority: 82, execute: () => pickupNearbyDrops(10.0) };
    }

    // 2. Night shelter
    if (isNight && shelterCaution > 0.62 && getBestItem(BUILD_BLOCKS)?.count >= 16 && Math.random() < 0.25) {
      return { name: 'build_night_shelter', priority: 80, execute: buildQuickShelter };
    }

    // 3. Stage 1 -> Wood & Stone Tech Tree
    if (!hasToolTierOrBetter(PICKAXE_NAMES, 'stone_pickaxe')) {
      const needTable = !hasCraftingTableReady();
      const singlePlanks = getMaxSinglePlankCount();
      const stickRecipeReady = Boolean(mcData?.itemsByName?.stick && bot.recipesFor(mcData.itemsByName.stick.id, null, 1, null).length);

      if (getTotalWoodLogs() > 0 && (getTotalPlanks() < 8 || (needTable && singlePlanks < 4) || (!stickRecipeReady && inventoryCount('stick') < 4))) {
        return { name: 'craft_planks', priority: 78, execute: craftPlanksFromLogs };
      }
      if (getTotalWoodLogs() === 0 && (getTotalPlanks() < 6 || (needTable && singlePlanks < 4) || (!stickRecipeReady && inventoryCount('stick') < 4))) {
        return { name: 'gather_initial_wood', priority: 78, execute: () => gatherWood(6) };
      }
      if (inventoryCount('stick') < 4 && stickRecipeReady && !isCraftOnCooldown('stick')) {
        return { name: 'craft_sticks', priority: 76, execute: () => craftSticks(4) };
      }
      if (!hasToolTierOrBetter(PICKAXE_NAMES, 'wooden_pickaxe')) {
        if (!isCraftOnCooldown('wooden_pickaxe') && getTotalPlanks() >= 3 && inventoryCount('stick') >= 2 && (!needTable || singlePlanks >= 4)) {
          return {
            name: 'craft_wooden_pickaxe',
            priority: 75,
            execute: async () => {
              if (hasToolTierOrBetter(PICKAXE_NAMES, 'wooden_pickaxe')) return true;
              await craftSticks(2);
              const okWooden = await craftItem('wooden_pickaxe', 1, true);
              if (okWooden) evo.recordAgentMilestone(agentSlot, 'wooden_pickaxe_crafted', 1, 2.0);
              return okWooden;
            }
          };
        }
        return { name: 'gather_initial_wood', priority: 74, execute: () => gatherWood(6) };
      }
      if (!hasToolTierOrBetter(SWORD_NAMES, 'wooden_sword') && !isCraftOnCooldown('wooden_sword') && getTotalPlanks() >= 2 && inventoryCount('stick') >= 1) {
        return {
          name: 'craft_wooden_sword',
          priority: 74.5,
          execute: async () => { await craftSticks(2); return await craftItem('wooden_sword', 1, true); }
        };
      }
      if (!hasToolTierOrBetter(AXE_NAMES, 'wooden_axe') && !isCraftOnCooldown('wooden_axe') && getTotalPlanks() >= 3 && inventoryCount('stick') >= 2) {
        return {
          name: 'craft_wooden_axe',
          priority: 74.2,
          execute: async () => { await craftSticks(2); return await craftItem('wooden_axe', 1, true); }
        };
      }
      if (inventoryCount('cobblestone') < 4) {
        requestSwarmResourceHelp('cobblestone', 4, 1);
      }
      if (inventoryCount('cobblestone') < 12) {
        return { name: 'gather_cobblestone', priority: 74, execute: gatherCobblestoneSmart };
      }
      if (!isCraftOnCooldown('stone_pickaxe') && inventoryCount('cobblestone') >= 3 && inventoryCount('stick') >= 2) {
        return {
          name: 'craft_stone_pickaxe',
          priority: 73,
          execute: async () => {
            if (hasToolTierOrBetter(PICKAXE_NAMES, 'stone_pickaxe')) return true;
            await craftSticks(4);
            const ok = await craftItem('stone_pickaxe', 1, true);
            if (ok) evo.recordAgentMilestone(agentSlot, 'stone_pickaxe_crafted', 2, 2.5);
            return ok;
          }
        };
      }

      // Only mine stone when wooden_pickaxe is actually owned!
      return { name: 'gather_cobblestone', priority: 70, execute: gatherCobblestoneSmart };
    }

    if (!hasToolTierOrBetter(SWORD_NAMES, 'stone_sword') && !isCraftOnCooldown('stone_sword') && inventoryCount('cobblestone') >= 2 && getTotalPlanks() >= 2) {
      return {
        name: 'craft_stone_sword',
        priority: 71,
        execute: async () => { await craftSticks(2); return await craftItem('stone_sword', 1, true); }
      };
    }

    if (!hasToolTierOrBetter(AXE_NAMES, 'stone_axe') && !isCraftOnCooldown('stone_axe') && inventoryCount('cobblestone') >= 3 && getTotalPlanks() >= 2) {
      return {
        name: 'craft_stone_axe',
        priority: 70,
        execute: async () => { await craftSticks(2); return await craftItem('stone_axe', 1, true); }
      };
    }

    if (getTotalWoodLogs() < 3 && getTotalPlanks() < 8) {
      return { name: 'restock_wood', priority: 68, execute: () => gatherWood(6) };
    }

    // 4. Coal & Smelting
    if (inventoryCount('coal') + inventoryCount('charcoal') < 6) {
      const coal = findBlockByNames(['coal_ore', 'deepslate_coal_ore'], 28, false, true);
      if (coal) return { name: 'mine_coal', priority: 67, execute: () => gatherResourceByNames(['coal_ore', 'deepslate_coal_ore'], 'pickaxe') };
    }

    if (inventoryCount('raw_iron') >= 3 && (inventoryCount('coal') > 0 || getTotalPlanks() >= 4)) {
      return { name: 'smelt_iron', priority: 66, execute: () => smeltItem('raw_iron', 8) };
    }

    if (inventoryCount('raw_gold') >= 2 && (inventoryCount('coal') > 0 || getTotalPlanks() >= 4)) {
      return { name: 'smelt_gold', priority: 65, execute: () => smeltItem('raw_gold', 8) };
    }

    // 5. Stage 2 -> Iron Gear + Shield + Water Bucket
    if (!hasToolTierOrBetter(PICKAXE_NAMES, 'iron_pickaxe')) {
      if (inventoryCount('iron_ingot') >= 3 && !isCraftOnCooldown('iron_pickaxe') && craftPriority > 0.1) {
        return {
          name: 'craft_iron_pickaxe',
          priority: 64,
          execute: async () => { await craftSticks(2); const ok = await craftItem('iron_pickaxe', 1, true); if (ok) evo.recordAgentMilestone(agentSlot, 'iron_pickaxe_crafted', 3, 3.0); return ok; }
        };
      }
      return {
        name: 'mine_iron_ore',
        priority: 63,
        execute: () => gatherResourceByNames(['iron_ore', 'deepslate_iron_ore'], 'pickaxe', 16)
      };
    }

    const hasShield = inventoryCount('shield') > 0 || bot.inventory.slots[45]?.name === 'shield';
    if (!hasShield && !isCraftOnCooldown('shield') && inventoryCount('iron_ingot') >= 1 && getTotalPlanks() >= 6) {
      return {
        name: 'craft_shield',
        priority: 62,
        execute: async () => { const ok = await craftItem('shield', 1, true); await equipShield(); return ok; }
      };
    }

    if (!hasToolTierOrBetter(SWORD_NAMES, 'iron_sword') && !isCraftOnCooldown('iron_sword') && inventoryCount('iron_ingot') >= 2) {
      return {
        name: 'craft_iron_sword',
        priority: 61,
        execute: async () => { await craftSticks(2); return await craftItem('iron_sword', 1, true); }
      };
    }

    if (!hasToolTierOrBetter(AXE_NAMES, 'iron_axe') && !isCraftOnCooldown('iron_axe') && inventoryCount('iron_ingot') >= 3) {
      return {
        name: 'craft_iron_axe',
        priority: 60.5,
        execute: async () => { await craftSticks(2); return await craftItem('iron_axe', 1, true); }
      };
    }

    // Water Bucket for MLG & Obsidian casting
    if (inventoryCount('water_bucket') === 0) {
      if (inventoryCount('bucket') > 0 && findBlockByNames(['water'], 32, true, false)) {
        return { name: 'fill_water_bucket', priority: 60, execute: fillWaterBucketIfNearby };
      }
      if (inventoryCount('bucket') === 0 && inventoryCount('iron_ingot') >= 3 && !isCraftOnCooldown('bucket')) {
        return { name: 'craft_bucket', priority: 59, execute: () => craftItem('bucket', 1, true) };
      }
    }

    // Iron Armor
    const ironArmorPieces = [
      { name: 'iron_chestplate', cost: 8, slot: 6 },
      { name: 'iron_leggings', cost: 7, slot: 7 },
      { name: 'iron_helmet', cost: 5, slot: 5 },
      { name: 'iron_boots', cost: 4, slot: 8 }
    ];
    for (const p of ironArmorPieces) {
      if (!bot.inventory.slots[p.slot] && inventoryCount(p.name) === 0 && inventoryCount('iron_ingot') >= p.cost && !isCraftOnCooldown(p.name)) {
        return {
          name: `craft_${p.name}`,
          priority: 58,
          execute: async () => { const ok = await craftItem(p.name, 1, true); await upgradeArmor(); return ok; }
        };
      }
    }

    // 6. Stage 3 -> Diamond Pickaxe, Sword & Armor (Mine down to Y=-54)
    if (hasToolTierOrBetter(PICKAXE_NAMES, 'iron_pickaxe')) {
      if (!hasToolTierOrBetter(PICKAXE_NAMES, 'diamond_pickaxe')) {
        if (inventoryCount('diamond') >= 3 && !isCraftOnCooldown('diamond_pickaxe')) {
          return {
          name: 'craft_diamond_pickaxe',
          priority: 57,
          execute: async () => { await craftSticks(2); const ok = await craftItem('diamond_pickaxe', 1, true); if (ok) evo.recordAgentMilestone(agentSlot, 'diamond_pickaxe_crafted', 4, 3.5); return ok; }
          };
        }
        return {
          name: 'mine_diamond_ore',
          priority: 56,
          execute: () => gatherResourceByNames(['diamond_ore', 'deepslate_diamond_ore'], 'pickaxe', -54)
        };
      }

      if (!hasToolTierOrBetter(SWORD_NAMES, 'diamond_sword') && inventoryCount('diamond') >= 2 && !isCraftOnCooldown('diamond_sword')) {
        return {
          name: 'craft_diamond_sword',
          priority: 55,
          execute: async () => { await craftSticks(2); return await craftItem('diamond_sword', 1, true); }
        };
      }

      if (!hasToolTierOrBetter(AXE_NAMES, 'diamond_axe') && inventoryCount('diamond') >= 3 && !isCraftOnCooldown('diamond_axe')) {
        return {
          name: 'craft_diamond_axe',
          priority: 54.5,
          execute: async () => { await craftSticks(2); return await craftItem('diamond_axe', 1, true); }
        };
      }

      const diaArmorPieces = [
        { name: 'diamond_chestplate', cost: 8, slot: 6 },
        { name: 'diamond_leggings', cost: 7, slot: 7 },
        { name: 'diamond_helmet', cost: 5, slot: 5 },
        { name: 'diamond_boots', cost: 4, slot: 8 }
      ];
      for (const p of diaArmorPieces) {
        const eq = bot.inventory.slots[p.slot]?.name || '';
        const hasBetter = eq.startsWith('diamond_') || eq.startsWith('netherite_');
        if (!hasBetter && inventoryCount(p.name) === 0 && inventoryCount('diamond') >= p.cost && !isCraftOnCooldown(p.name)) {
          return {
            name: `craft_${p.name}`,
            priority: 54,
            execute: async () => { const ok = await craftItem(p.name, 1, true); await upgradeArmor(); return ok; }
          };
        }
      }
    }

    // 7. Stage 4 -> Flint & Steel + Obsidian + Nether Portal!
    if (hasToolTierOrBetter(PICKAXE_NAMES, 'diamond_pickaxe') && bot.game?.dimension !== 'the_nether') {
      const portalExists = Boolean(ensureSwarmContext().stations.nether_portal || memory.portalPosition);

      if (!portalExists) {
        if (inventoryCount('flint_and_steel') === 0) {
          if (inventoryCount('flint') === 0) {
            return {
              name: 'gather_flint_from_gravel',
              priority: 53,
              execute: () => gatherResourceByNames(['gravel'], 'shovel', null)
            };
          }
          if (inventoryCount('iron_ingot') >= 1 && !isCraftOnCooldown('flint_and_steel')) {
            return { name: 'craft_flint_and_steel', priority: 53, execute: () => craftItem('flint_and_steel', 1, false) };
          }
        }
        if (inventoryCount('obsidian') < 10) {
          return { name: 'gather_obsidian', priority: 52, execute: obtainObsidianSmart };
        }
        return { name: 'build_nether_portal', priority: 52, execute: buildAndLightNetherPortal };
      }

      // Portal ready -> enter Nether once Diamond gear + some food are ready!
      if (portalExists && getTotalEdibleFood() >= 2) {
        return { name: 'enter_nether', priority: 51, execute: enterNetherPortal };
      }
    }

    // 8. Stage 5 & 6 -> Nether: Ancient Debris + Gold + Smithing Template -> Netherite Armor!
    if (bot.game?.dimension === 'the_nether') {
      if (inventoryCount('netherite_ingot') >= 1 && inventoryCount('netherite_upgrade_smithing_template') >= 1) {
        return { name: 'upgrade_netherite_armor', priority: 72, execute: upgradeDiamondToNetheriteArmor };
      }
      if (inventoryCount('ancient_debris') >= 4 && (inventoryCount('coal') > 0 || getTotalPlanks() >= 4)) {
        return { name: 'smelt_ancient_debris', priority: 66, execute: () => smeltItem('ancient_debris', 4) };
      }
      if (inventoryCount('netherite_scrap') >= 4 && inventoryCount('gold_ingot') >= 4 && !isCraftOnCooldown('netherite_ingot')) {
        return { name: 'craft_netherite_ingot', priority: 65, execute: () => craftItem('netherite_ingot', 1, true) };
      }
      if (inventoryCount('netherite_upgrade_smithing_template') === 0) {
        const chestNear = findBlockByNames(['chest'], 32, false, false);
        if (chestNear) {
          return { name: 'search_bastion_template', priority: 64, execute: searchNearbyChestsForTemplate };
        }
      }
      if (inventoryCount('gold_ingot') < 4) {
        const gold = findBlockByNames(['nether_gold_ore', 'gilded_blackstone'], 28, false, false);
        if (gold) {
          return { name: 'mine_nether_gold', priority: 60, execute: () => gatherResourceByNames(['nether_gold_ore'], 'pickaxe', null) };
        }
      }
      if (inventoryCount('ancient_debris') + inventoryCount('netherite_scrap') < 16) {
        return {
          name: 'mine_ancient_debris',
          priority: 58,
          execute: () => gatherResourceByNames(['ancient_debris'], 'pickaxe', 15)
        };
      }
    }

    if (bot.inventory.items().length >= 28) {
      return { name: 'deposit_excess_items', priority: 50, execute: depositExcessToChest };
    }

    // Role-balanced mining/resource gathering when idle
    if (role === 'MINER' && gatherPriority > 0.3) {
      const targetY = hasToolTierOrBetter(PICKAXE_NAMES, 'iron_pickaxe') ? -54 : 16;
      return {
        name: 'branch_mine_ores',
        priority: 45,
        execute: () => safeStepMineDown(targetY, ['diamond_ore', 'deepslate_diamond_ore', 'iron_ore', 'deepslate_iron_ore', 'coal_ore'])
      };
    }

    return { name: 'exploration', priority: 40, execute: explore };
  }

  function getDeathContext() {
    const pos = bot.entity?.position?.floored();
    const blockFeet = pos ? bot.blockAt(pos) : null;
    const blockBelow = pos ? bot.blockAt(pos.offset(0, -1, 0)) : null;
    const inLavaOrFire = Boolean(
      (blockFeet && ['lava', 'flowing_lava', 'fire', 'soul_fire'].includes(blockFeet.name)) ||
      (blockBelow && ['lava', 'flowing_lava', 'fire', 'soul_fire'].includes(blockBelow.name))
    );
    const recentAttacker = (Date.now() - lastCombatTimestamp < 15000) ? lastCombatTargetName : null;

    return {
      attackerName: revengeTargetName || recentAttacker || nearestHostile(6)?.name || null,
      activeSkill: activeSkillContext,
      stage: state.stage,
      goal: state.currentGoal,
      falling: Boolean(bot.entity && bot.entity.velocity.y < -0.55 && !bot.entity.isInWater),
      creeperNearby: Boolean(nearestCreeper(7)),
      inLavaOrFire,
      food: bot.food ?? 20,
      stateVector: buildStateVector()
    };
  }

  return {
    isHostileEntity,
    isCreeperEntity,
    findPlayerEntity,
    normalizePlayerName,
    getVisiblePlayerNames: () => Object.entries(bot.players || {}).filter(([, info]) => info?.entity && info.entity.isValid !== false).map(([name]) => name),
    getInventorySummaryText,
    getKnowledgeSummaryText,
    getProgressChecklistText,
    getTeamStatusText,
    getSwarmRole,
    bindTaskHooks,
    setMcData,
    applyPhysicsWorkaround,
    autoJumpTick,
    swimTick,
    smartCombatTick,
    stopCombat,
    markRespawned: () => { respawnGraceUntil = Date.now() + 4500; },
    cooperationTick,
    setGoal,
    clearMovement,
    useNavigationMovements,
    useMiningMovements,
    moveToGoal,
    nearestHostile,
    buildStateVector,
    checkAndPerformMLG,
    observeParkourTick,
    upgradeArmor,
    equipShield,
    equipBestWeapon,
    equipBestPickaxe,
    eatFood,
    avoidCreepers,
    defensiveCombat,
    hasFoodAnimalNearby,
    engageMobTarget,
    protectFriendlyPlayer,
    playerRevengeTick,
    onEntitySwingArm,
    onEntityHurt,
    onEntityDead,
    placeStrategicTrap,
    buildDefensiveBarricade,
    safeSneakBridge,
    buildQuickShelter,
    recoverFromStuck,
    movementWatchdogTick,
    collectBlockSafely,
    gatherWood,
    computeProgressionStage,
    selectDynamicSurvivalGoal,
    selectCoopActionTask,
    triggerSquadRally: () => {
      const sc = ensureSwarmContext();
      sc.rallyUntil = Date.now() + 15000;
    },
    getDeathContext,
    getGuardUsername: () => guardUsername,
    setGuardUsername: (u) => { guardUsername = u; },
    getGuardMode: () => guardMode,
    setGuardOrder,
    getBasePosition: () => basePosition,
    setBasePosition: (p) => { basePosition = p; },
    getRevengeTargetName: () => revengeTargetName,
    clearRevenge: () => { revengeTargetName = null; }
  };
}

module.exports = { createSkillController };
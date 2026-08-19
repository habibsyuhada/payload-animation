import { BATTLE_TICK_LIMIT } from "./fixed.js";
import type { AccountTierConfig, BlockTier, DefenseNodeType, MovementBlockKind, Ruleset } from "./types.js";

/**
 * Numeric source of truth mirrored from docs/RULESET.md §1 (budgets) and §5.2 (Core HP).
 * Changing these values means bumping RulesetVersion to a new file (PLAN.md DoD #3) —
 * never edit v1 numbers in place once a BattleLog referencing "v1" exists.
 */
const ACCOUNT_TIERS_V1: readonly AccountTierConfig[] = [
  { tier: 1, payloadBudgetKb: 2400, defenseBudgetPoints: 20, coreHp: 1800 },
  { tier: 2, payloadBudgetKb: 2700, defenseBudgetPoints: 24, coreHp: 2000 },
  { tier: 3, payloadBudgetKb: 3000, defenseBudgetPoints: 28, coreHp: 2200 },
  { tier: 4, payloadBudgetKb: 3300, defenseBudgetPoints: 32, coreHp: 2400 },
  { tier: 5, payloadBudgetKb: 3600, defenseBudgetPoints: 36, coreHp: 2600 },
];

export const RULESET_V1: Ruleset = {
  version: "v1",
  tickLimit: BATTLE_TICK_LIMIT,
  accountTiers: ACCOUNT_TIERS_V1,
};

export function getAccountTierConfig(ruleset: Ruleset, tier: AccountTierConfig["tier"]): AccountTierConfig {
  const config = ruleset.accountTiers.find((entry) => entry.tier === tier);
  if (!config) {
    throw new Error(`no account tier config for tier ${tier} in ruleset ${ruleset.version}`);
  }
  return config;
}

/** Topology rules, RULESET.md §6. */
export const ENTRY_NODE_COUNT_V1 = 2;
export const CORE_NODE_COUNT_V1 = 1;
export const EDGE_LENGTH_MIN_DU = 200;
export const EDGE_LENGTH_MAX_DU = 2000;

interface DefenseNodeCostEntry {
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  readonly costPoints: number;
}

/** Node costs, RULESET.md §5.1. Entry/Core are structural and never purchased (cost 0). */
const DEFENSE_NODE_COSTS_V1: readonly DefenseNodeCostEntry[] = [
  { type: "router", costPoints: 1 },
  { type: "entry", costPoints: 0 },
  { type: "core", costPoints: 0 },
  { type: "firewall", tier: 1, costPoints: 3 },
  { type: "firewall", tier: 2, costPoints: 5 },
  { type: "firewall", tier: 3, costPoints: 8 },
  { type: "ice-sentry", tier: 1, costPoints: 4 },
  { type: "ice-sentry", tier: 2, costPoints: 6 },
  { type: "ice-sentry", tier: 3, costPoints: 9 },
  { type: "honeypot", tier: 1, costPoints: 3 },
  { type: "honeypot", tier: 2, costPoints: 5 },
  { type: "honeypot", tier: 3, costPoints: 8 },
  { type: "scanner", tier: 1, costPoints: 2 },
  { type: "scanner", tier: 2, costPoints: 3 },
  { type: "scanner", tier: 3, costPoints: 5 },
  { type: "trap", tier: 1, costPoints: 2 },
  { type: "trap", tier: 2, costPoints: 3 },
  { type: "trap", tier: 3, costPoints: 5 },
];

export function getDefenseNodeCost(type: DefenseNodeType, tier?: BlockTier): number {
  const entry = DEFENSE_NODE_COSTS_V1.find((candidate) => candidate.type === type && candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 defense node cost for type "${type}" tier ${tier ?? "(untiered)"}`);
  }
  return entry.costPoints;
}

interface MovementBlockConfig {
  readonly kind: MovementBlockKind;
  readonly weightKb: number;
  readonly speedDuPerTick: number;
}

/** Movement block weight/speed, RULESET.md §3. Untiered by design (v1). */
const MOVEMENT_BLOCKS_V1: readonly MovementBlockConfig[] = [
  { kind: "shortest-path", weightKb: 800, speedDuPerTick: 50 },
  { kind: "random-walk", weightKb: 500, speedDuPerTick: 55 },
  { kind: "backtrack", weightKb: 600, speedDuPerTick: 50 },
];

export function getMovementBlockConfig(kind: MovementBlockKind): MovementBlockConfig {
  const entry = MOVEMENT_BLOCKS_V1.find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new Error(`no v1 movement block config for kind "${kind}"`);
  }
  return entry;
}

/** All Breach nodes (Firewall, Core) take this much HP loss per tick from mere occupancy, RULESET.md §5.0. */
export const BREACH_PASSIVE_DRAIN_V1 = 15;

interface FirewallConfig {
  readonly tier: BlockTier;
  readonly hp: number;
  readonly counterDamagePerTick: number;
}

/** RULESET.md §5.1. */
const FIREWALL_CONFIG_V1: readonly FirewallConfig[] = [
  { tier: 1, hp: 500, counterDamagePerTick: 20 },
  { tier: 2, hp: 800, counterDamagePerTick: 30 },
  { tier: 3, hp: 1200, counterDamagePerTick: 45 },
];

export function getFirewallConfig(tier: BlockTier): FirewallConfig {
  const entry = FIREWALL_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 firewall config for tier ${tier}`);
  }
  return entry;
}

interface IceSentryConfig {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly fireIntervalTicks: number;
  readonly damage: number;
  readonly accuracyPermille: number;
}

/** RULESET.md §5.1. */
const ICE_SENTRY_CONFIG_V1: readonly IceSentryConfig[] = [
  { tier: 1, radiusHops: 1, fireIntervalTicks: 4, damage: 60, accuracyPermille: 850 },
  { tier: 2, radiusHops: 1, fireIntervalTicks: 3, damage: 85, accuracyPermille: 880 },
  { tier: 3, radiusHops: 2, fireIntervalTicks: 3, damage: 115, accuracyPermille: 900 },
];

export function getIceSentryConfig(tier: BlockTier): IceSentryConfig {
  const entry = ICE_SENTRY_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 ICE Sentry config for tier ${tier}`);
  }
  return entry;
}

interface ScannerConfig {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly durationTicks: number;
  readonly iceAccuracyBonusPermille: number;
}

/** RULESET.md §5.1. */
const SCANNER_CONFIG_V1: readonly ScannerConfig[] = [
  { tier: 1, radiusHops: 1, durationTicks: 6, iceAccuracyBonusPermille: 150 },
  { tier: 2, radiusHops: 2, durationTicks: 8, iceAccuracyBonusPermille: 200 },
  { tier: 3, radiusHops: 2, durationTicks: 10, iceAccuracyBonusPermille: 250 },
];

export function getScannerConfig(tier: BlockTier): ScannerConfig {
  const entry = SCANNER_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 scanner config for tier ${tier}`);
  }
  return entry;
}

const TRAP_DAMAGE_V1: Readonly<Record<BlockTier, number>> = { 1: 180, 2: 260, 3: 350 };

/** RULESET.md §5.1. */
export function getTrapDamage(tier: BlockTier): number {
  return TRAP_DAMAGE_V1[tier];
}

/*
 * --- Logic block configs, RULESET.md §4 (S1.5) ---
 * Weight (payload KB) isn't consumed by simulate() — it belongs to virus-budget validation,
 * not battle physics — so it isn't modeled here; only the tables simulate() actually reads.
 */

interface ScanAheadConfig {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly revealsTraps: boolean;
}

const SCAN_AHEAD_CONFIG_V1: readonly ScanAheadConfig[] = [
  { tier: 1, radiusHops: 1, revealsTraps: false },
  { tier: 2, radiusHops: 2, revealsTraps: false },
  { tier: 3, radiusHops: 2, revealsTraps: true },
];

export function getScanAheadConfig(tier: BlockTier): ScanAheadConfig {
  const entry = SCAN_AHEAD_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 scan-ahead config for tier ${tier}`);
  }
  return entry;
}

interface DetectHoneypotConfig {
  readonly tier: BlockTier;
  readonly radiusHops: number;
  readonly seesDisguise: boolean;
}

const DETECT_HONEYPOT_CONFIG_V1: readonly DetectHoneypotConfig[] = [
  { tier: 1, radiusHops: 1, seesDisguise: false },
  { tier: 2, radiusHops: 2, seesDisguise: false },
  { tier: 3, radiusHops: 2, seesDisguise: true },
];

export function getDetectHoneypotConfig(tier: BlockTier): DetectHoneypotConfig {
  const entry = DETECT_HONEYPOT_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 detect-honeypot config for tier ${tier}`);
  }
  return entry;
}

const BRUTE_FORCE_DAMAGE_V1: Readonly<Record<BlockTier, number>> = { 1: 40, 2: 60, 3: 85 };

export function getBruteForceDamagePerTick(tier: BlockTier): number {
  return BRUTE_FORCE_DAMAGE_V1[tier];
}

const EXPLOIT_DAMAGE_V1: Readonly<Record<BlockTier, number>> = { 1: 250, 2: 380, 3: 520 };

export function getExploitDamage(tier: BlockTier): number {
  return EXPLOIT_DAMAGE_V1[tier];
}

interface OverloadConfig {
  readonly tier: BlockTier;
  readonly splashDamage: number;
  readonly radiusHops: number;
}

const OVERLOAD_CONFIG_V1: readonly OverloadConfig[] = [
  { tier: 1, splashDamage: 150, radiusHops: 1 },
  { tier: 2, splashDamage: 230, radiusHops: 1 },
  { tier: 3, splashDamage: 320, radiusHops: 2 },
];

export function getOverloadConfig(tier: BlockTier): OverloadConfig {
  const entry = OVERLOAD_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 overload config for tier ${tier}`);
  }
  return entry;
}

const CLOAK_DURATION_NODES_V1: Readonly<Record<BlockTier, number>> = { 1: 3, 2: 4, 3: 5 };

/**
 * RULESET.md §4.4 tier III also grants "-50% Scanner detection radius while Cloak is active" —
 * skipped: Cloak already grants full Scanner-status immunity while active, which strictly
 * dominates a radius reduction, so the sub-clause has no observable effect to implement.
 */
export function getCloakDurationNodes(tier: BlockTier): number {
  return CLOAK_DURATION_NODES_V1[tier];
}

interface SlowCrawlConfig {
  readonly tier: BlockTier;
  readonly speedMultiplierPermille: number;
  readonly iceAccuracyReductionPermille: number;
}

const SLOW_CRAWL_CONFIG_V1: readonly SlowCrawlConfig[] = [
  { tier: 1, speedMultiplierPermille: 700, iceAccuracyReductionPermille: 300 },
  { tier: 2, speedMultiplierPermille: 750, iceAccuracyReductionPermille: 400 },
  { tier: 3, speedMultiplierPermille: 800, iceAccuracyReductionPermille: 500 },
];

export function getSlowCrawlConfig(tier: BlockTier): SlowCrawlConfig {
  const entry = SLOW_CRAWL_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 slow-crawl config for tier ${tier}`);
  }
  return entry;
}

const SELF_REPAIR_HEAL_V1: Readonly<Record<BlockTier, number>> = { 1: 5, 2: 8, 3: 12 };

export function getSelfRepairHealPerTick(tier: BlockTier): number {
  return SELF_REPAIR_HEAL_V1[tier];
}

interface SacrificeDecoyConfig {
  readonly tier: BlockTier;
  readonly chargesTotal: number;
  readonly absorbsPerActivation: number;
}

const SACRIFICE_DECOY_CONFIG_V1: readonly SacrificeDecoyConfig[] = [
  { tier: 1, chargesTotal: 1, absorbsPerActivation: 1 },
  { tier: 2, chargesTotal: 2, absorbsPerActivation: 1 },
  { tier: 3, chargesTotal: 3, absorbsPerActivation: 2 },
];

export function getSacrificeDecoyConfig(tier: BlockTier): SacrificeDecoyConfig {
  const entry = SACRIFICE_DECOY_CONFIG_V1.find((candidate) => candidate.tier === tier);
  if (!entry) {
    throw new Error(`no v1 sacrifice-decoy config for tier ${tier}`);
  }
  return entry;
}

/** RULESET.md §4.2: first Sacrifice Decoy arm threshold, and each re-arm's drop from the last trigger point. */
export const SACRIFICE_DECOY_THRESHOLD_STEP_PERMILLE = 200;

/** RULESET.md §4.2: tier I default threshold for "IF Integrity < X%" when the player hasn't configured one. */
export const DEFAULT_INTEGRITY_THRESHOLD_PERMILLE = 500;

/** RULESET.md §4.2: default target for "IF Node = Firewall" when the player hasn't configured one. */
export const DEFAULT_CONDITION_TARGET_NODE_TYPES: readonly DefenseNodeType[] = ["firewall"];

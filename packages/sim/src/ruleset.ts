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
export const BREACH_PASSIVE_DRAIN_V1 = 10;

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

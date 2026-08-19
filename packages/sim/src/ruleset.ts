import { BATTLE_TICK_LIMIT } from "./fixed.js";
import type { AccountTierConfig, BlockTier, DefenseNodeType, Ruleset } from "./types.js";

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

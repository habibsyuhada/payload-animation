import { BATTLE_TICK_LIMIT } from "./fixed.js";
import type { AccountTierConfig, Ruleset } from "./types.js";

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

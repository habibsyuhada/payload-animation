import { describe, expect, it } from "vitest";
import { getAccountTierConfig, RULESET_V1 } from "../src/ruleset.js";

describe("RULESET_V1", () => {
  it("matches docs/RULESET.md §1/§5.2 budgets and Core HP per account tier", () => {
    expect(RULESET_V1.version).toBe("v1");
    expect(RULESET_V1.tickLimit).toBe(1200);
    expect(RULESET_V1.accountTiers).toEqual([
      { tier: 1, payloadBudgetKb: 2400, defenseBudgetPoints: 20, coreHp: 1800 },
      { tier: 2, payloadBudgetKb: 2700, defenseBudgetPoints: 24, coreHp: 2000 },
      { tier: 3, payloadBudgetKb: 3000, defenseBudgetPoints: 28, coreHp: 2200 },
      { tier: 4, payloadBudgetKb: 3300, defenseBudgetPoints: 32, coreHp: 2400 },
      { tier: 5, payloadBudgetKb: 3600, defenseBudgetPoints: 36, coreHp: 2600 },
    ]);
  });

  it("budgets and Core HP increase monotonically with account tier", () => {
    const tiers = RULESET_V1.accountTiers;
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i]!.payloadBudgetKb).toBeGreaterThan(tiers[i - 1]!.payloadBudgetKb);
      expect(tiers[i]!.defenseBudgetPoints).toBeGreaterThan(tiers[i - 1]!.defenseBudgetPoints);
      expect(tiers[i]!.coreHp).toBeGreaterThan(tiers[i - 1]!.coreHp);
    }
  });
});

describe("getAccountTierConfig", () => {
  it("returns the config for a known tier", () => {
    expect(getAccountTierConfig(RULESET_V1, 3)).toEqual({
      tier: 3,
      payloadBudgetKb: 3000,
      defenseBudgetPoints: 28,
      coreHp: 2200,
    });
  });

  it("throws for an unknown tier", () => {
    const emptyRuleset = { ...RULESET_V1, accountTiers: [] };
    expect(() => getAccountTierConfig(emptyRuleset, 1)).toThrow();
  });
});

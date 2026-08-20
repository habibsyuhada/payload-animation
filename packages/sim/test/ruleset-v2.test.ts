import { describe, expect, it } from "vitest";
import {
  ACTION_SPECS_V2,
  CONDITION_SPECS_V2,
  MAX_SHEET_DEPTH_V2,
  RULESET_V2,
  getActionSpec,
  getActionWeightKb,
  getCloakConfigV2,
  getConditionRadiusHops,
  getConditionSpec,
  getConditionWeightKb,
} from "../src/ruleset-v2.js";
import { RULESET_V1, getAccountTierConfig } from "../src/ruleset.js";
import type { ActionKind, BlockTier, ConditionKind } from "../src/types.js";

/**
 * Guards the catalog against the one failure mode a table like this actually has: a kind added to
 * the type union in types.ts and never priced, which would only surface as a thrown error deep
 * inside a battle.
 */

const ALL_CONDITION_KINDS: readonly ConditionKind[] = [
  "node-here-is",
  "node-ahead-is",
  "honeypot-near",
  "trap-near",
  "integrity-below",
  "is-scanned",
  "took-damage-last-tick",
  "on-breach-node",
  "at-node",
];

const ALL_ACTION_KINDS: readonly ActionKind[] = [
  "move-toward-core",
  "move-avoiding-hazards",
  "move-random",
  "move-back",
  "hold-position",
  "brute-force",
  "exploit",
  "overload",
  "cloak",
  "slow-crawl",
  "self-repair",
  "arm-decoy",
];

const TIERS: readonly BlockTier[] = [1, 2, 3];

describe("v2 catalog coverage", () => {
  it("prices every condition kind at every tier", () => {
    expect(CONDITION_SPECS_V2.map((spec) => spec.kind).sort()).toEqual([...ALL_CONDITION_KINDS].sort());
    for (const kind of ALL_CONDITION_KINDS) {
      for (const tier of TIERS) {
        expect(getConditionWeightKb(kind, tier)).toBeGreaterThan(0);
      }
    }
  });

  it("prices every action kind at every tier", () => {
    expect(ACTION_SPECS_V2.map((spec) => spec.kind).sort()).toEqual([...ALL_ACTION_KINDS].sort());
    for (const kind of ALL_ACTION_KINDS) {
      for (const tier of TIERS) {
        expect(getActionWeightKb(kind, tier)).toBeGreaterThan(0);
      }
    }
  });

  it("gives every movement action the movement slot, and only those", () => {
    const movementSlotted = ACTION_SPECS_V2.filter((spec) => spec.slot === "movement").map((spec) => spec.kind);
    expect(movementSlotted).toEqual(ACTION_SPECS_V2.filter((spec) => spec.category === "movement").map((spec) => spec.kind));
  });

  it("gives the attack actions no slot at all — they are the cumulative ones", () => {
    for (const spec of ACTION_SPECS_V2.filter((candidate) => candidate.category === "attack")) {
      expect(spec.slot).toBeUndefined();
    }
    expect(getActionSpec("self-repair").slot).toBeUndefined();
  });

  it("gives a travelling speed to every movement action except the one that refuses to move", () => {
    for (const spec of ACTION_SPECS_V2.filter((candidate) => candidate.category === "movement")) {
      if (spec.kind === "hold-position") {
        expect(spec.speedDuPerTick).toBeUndefined();
      } else {
        expect(spec.speedDuPerTick).toBeGreaterThan(0);
      }
    }
  });

  it("widens sensor radius with tier and leaves non-sensor conditions at radius 0", () => {
    for (const kind of ["honeypot-near", "trap-near"] as const) {
      expect(getConditionRadiusHops(kind, 1)).toBeLessThan(getConditionRadiusHops(kind, 3));
    }
    expect(getConditionRadiusHops("at-node", 1)).toBe(0);
    expect(getConditionSpec("honeypot-near").seesDisguiseFromTier).toBe(3);
  });

  it("throws on an unknown kind rather than silently pricing it at zero", () => {
    expect(() => getConditionSpec("nope" as ConditionKind)).toThrow(/no v2 condition spec/);
    expect(() => getActionSpec("nope" as ActionKind)).toThrow(/no v2 action spec/);
  });
});

describe("v2 account tiers", () => {
  it("keeps v1's budgets and adds an event-count cap that grows with tier", () => {
    for (const tier of [1, 2, 3, 4, 5] as const) {
      const v1 = getAccountTierConfig(RULESET_V1, tier);
      const v2 = getAccountTierConfig(RULESET_V2, tier);
      expect(v2.payloadBudgetKb).toBe(v1.payloadBudgetKb);
      expect(v2.defenseBudgetPoints).toBe(v1.defenseBudgetPoints);
      expect(v2.coreHp).toBe(v1.coreHp);
      expect(v2.maxSheetEvents).toBeGreaterThan(0);
    }
    expect(getAccountTierConfig(RULESET_V2, 1).maxSheetEvents!).toBeLessThan(getAccountTierConfig(RULESET_V2, 5).maxSheetEvents!);
    expect(getAccountTierConfig(RULESET_V1, 1).maxSheetEvents).toBeUndefined();
  });

  it("caps nesting at the depth the portrait screen can show (GDD §3)", () => {
    expect(MAX_SHEET_DEPTH_V2).toBe(3);
  });
});

describe("v2 mechanic tables", () => {
  it("measures Cloak in ticks with a cooldown long enough to matter", () => {
    for (const tier of TIERS) {
      const config = getCloakConfigV2(tier);
      expect(config.durationTicks).toBeGreaterThan(0);
      expect(config.cooldownTicks).toBeGreaterThanOrEqual(config.durationTicks);
    }
    expect(getCloakConfigV2(1).durationTicks).toBeLessThan(getCloakConfigV2(3).durationTicks);
  });
});

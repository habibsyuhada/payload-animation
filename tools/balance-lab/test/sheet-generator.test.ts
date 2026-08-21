import { MAX_SHEET_DEPTH_V2, RULESET_V2, createRng, getAccountTierConfig, sheetDepth, sheetHasMovementAction, validateVirusProgram } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { describeSheet, generatePopulation, generateSheet } from "../src/sheet-generator.js";

const TIER_1 = getAccountTierConfig(RULESET_V2, 1);
const LIMITS = { budgetKb: TIER_1.payloadBudgetKb, maxEvents: TIER_1.maxSheetEvents! };

describe("generateSheet", () => {
  it("is a pure function of its seed — the same seed rebuilds the same sheet", () => {
    const first = generateSheet(createRng(4242), LIMITS);
    const second = generateSheet(createRng(4242), LIMITS);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("produces different sheets from different seeds", () => {
    const sheets = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(generateSheet(createRng(seed), LIMITS))));
    expect(sheets.size).toBeGreaterThan(1);
  });

  it("always ends with a movement fallback row (bias 1 in the generator's docstring)", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const sheet = generateSheet(createRng(seed), LIMITS);
      expect(sheetHasMovementAction(sheet), `seed ${seed}`).toBe(true);
      const last = sheet.events[sheet.events.length - 1]!;
      expect(last.conditions, `seed ${seed}`).toEqual([]);
      expect(last.actions, `seed ${seed}`).toHaveLength(1);
    }
  });

  it("never exceeds the tier's budget, event cap, or nesting depth", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const sheet = generateSheet(createRng(seed), LIMITS);
      const result = validateVirusProgram(sheet, RULESET_V2, 1);
      expect(result.valid, `seed ${seed}: ${JSON.stringify(result.errors)}`).toBe(true);
      expect(sheetDepth(sheet), `seed ${seed}`).toBeLessThanOrEqual(MAX_SHEET_DEPTH_V2);
    }
  });

  it("produces nested rows, not just flat lists", () => {
    const depths = [...Array(40).keys()].map((index) => sheetDepth(generateSheet(createRng(index + 1), LIMITS)));
    expect(Math.max(...depths)).toBeGreaterThan(1);
  });

  /** PLAN.md 8.8: the generator has to reach every parameter PLAN.md 8.4 added (hops/ticks/
   * flagIndex/count/targetNodeTypes), or the search's coverage is stuck at pre-8.4 content. */
  it("eventually generates every new-in-8.4 condition/action parameter", () => {
    function allEvents(program: ReturnType<typeof generateSheet>): { conditions: readonly unknown[]; actions: readonly unknown[] }[] {
      function walk(events: readonly { conditions: readonly unknown[]; actions: readonly unknown[]; children: readonly unknown[] }[]): { conditions: readonly unknown[]; actions: readonly unknown[] }[] {
        return events.flatMap((event) => [event, ...walk(event.children as typeof events)]);
      }
      return walk(program.events);
    }

    const seen = { hops: false, thresholdPermille: false, ticksTickAfter: false, ticksEveryN: false, flagIndexCondition: false, count: false, moveTowardNodeType: false, setFlag: false, newDefenseNodeTarget: false };
    const newDefenseNodeTypes = new Set(["patch-server", "tarpit", "jammer", "turnstile", "alarm"]);

    for (let seed = 1; seed <= 400; seed += 1) {
      const sheet = generateSheet(createRng(seed), LIMITS);
      for (const event of allEvents(sheet)) {
        for (const condition of event.conditions as { kind: string; hops?: number; thresholdPermille?: number; ticks?: number; flagIndex?: number; count?: number; targetNodeTypes?: readonly string[] }[]) {
          if (condition.kind === "core-within-hops" && condition.hops !== undefined) seen.hops = true;
          if ((condition.kind === "core-hp-below" || condition.kind === "node-hp-below") && condition.thresholdPermille !== undefined) seen.thresholdPermille = true;
          if (condition.kind === "tick-after" && condition.ticks !== undefined) seen.ticksTickAfter = true;
          if (condition.kind === "every-n-ticks" && condition.ticks !== undefined) seen.ticksEveryN = true;
          if (condition.kind === "flag-is" && condition.flagIndex !== undefined) seen.flagIndexCondition = true;
          if (condition.kind === "entity-count-below" && condition.count !== undefined) seen.count = true;
          if (condition.targetNodeTypes?.some((type) => newDefenseNodeTypes.has(type))) seen.newDefenseNodeTarget = true;
        }
        for (const action of event.actions as { kind: string; targetNodeTypes?: readonly string[]; flagIndex?: number }[]) {
          if (action.kind === "move-toward-node-type") seen.moveTowardNodeType = true;
          if (action.kind === "set-flag" && action.flagIndex !== undefined) seen.setFlag = true;
          if (action.targetNodeTypes?.some((type) => newDefenseNodeTypes.has(type))) seen.newDefenseNodeTarget = true;
        }
      }
    }

    for (const [key, value] of Object.entries(seen)) {
      expect(value, `never saw ${key} across 400 seeds`).toBe(true);
    }
  });
});

describe("generatePopulation", () => {
  it("returns exactly the requested count, all valid, each named by its index", () => {
    const population = generatePopulation(99, 8);
    expect(population).toHaveLength(8);
    expect(population.map((virus) => virus.name)).toEqual(["Gen#1", "Gen#2", "Gen#3", "Gen#4", "Gen#5", "Gen#6", "Gen#7", "Gen#8"]);
    for (const virus of population) {
      expect(validateVirusProgram(virus.virus, RULESET_V2, 1).valid).toBe(true);
      expect(virus.weightKb).toBeLessThanOrEqual(TIER_1.payloadBudgetKb);
    }
  });

  it("is reproducible from its seed, so a flagged build in the report can be replayed", () => {
    expect(JSON.stringify(generatePopulation(7, 5))).toBe(JSON.stringify(generatePopulation(7, 5)));
  });
});

describe("describeSheet", () => {
  it("renders a sheet as one readable line, nesting included", () => {
    const described = describeSheet({
      events: [
        {
          conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }, { kind: "is-scanned", negate: true }],
          actions: [{ kind: "brute-force", tier: 2 }],
          children: [{ conditions: [], actions: [{ kind: "cloak", tier: 1 }], children: [], once: "battle" }],
        },
      ],
    });
    expect(described).toBe("[node-here-is & !is-scanned] -> brute-force.2 { [selalu] -> cloak (once:battle) }");
  });
});

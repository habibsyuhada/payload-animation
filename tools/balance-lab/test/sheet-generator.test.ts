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

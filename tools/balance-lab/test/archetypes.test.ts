import { RULESET_V1, RULESET_V2, getAccountTierConfig, sheetHasMovementAction, sheetWeightKb, validateDefenseGraph, validateVirusProgram } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { DEFENSE_ARCHETYPES, VIRUS_ARCHETYPES } from "../src/archetypes.js";

describe("DEFENSE_ARCHETYPES", () => {
  it("every defense archetype is a structurally valid tier-1 graph", () => {
    for (const defense of DEFENSE_ARCHETYPES) {
      const result = validateDefenseGraph(defense.graph, RULESET_V1, 1);
      expect(result, `${defense.name}: ${JSON.stringify(result.errors)}`).toEqual({ valid: true, errors: [] });
    }
  });

  it("has no duplicate archetype names", () => {
    expect(new Set(DEFENSE_ARCHETYPES.map((defense) => defense.name)).size).toBe(DEFENSE_ARCHETYPES.length);
  });
});

describe("VIRUS_ARCHETYPES (ruleset v2 sheets)", () => {
  it("every archetype is a sheet a tier-1 player could actually build", () => {
    for (const virus of VIRUS_ARCHETYPES) {
      const result = validateVirusProgram(virus.virus, RULESET_V2, 1);
      expect(result.valid, `${virus.name}: ${JSON.stringify(result.errors)}`).toBe(true);
      expect(result.weightKb, virus.name).toBeLessThanOrEqual(getAccountTierConfig(RULESET_V2, 1).payloadBudgetKb);
    }
  });

  it("every archetype can move — a parked virus measures nothing", () => {
    for (const virus of VIRUS_ARCHETYPES) {
      expect(sheetHasMovementAction(virus.virus), virus.name).toBe(true);
    }
  });

  it("quotes its real KB cost in its own description, so the report can't drift from the sheet", () => {
    for (const virus of VIRUS_ARCHETYPES) {
      expect(virus.description, virus.name).toContain(`${sheetWeightKb(virus.virus)} KB`);
    }
  });

  it("has no duplicate archetype names", () => {
    expect(new Set(VIRUS_ARCHETYPES.map((virus) => virus.name)).size).toBe(VIRUS_ARCHETYPES.length);
  });
});

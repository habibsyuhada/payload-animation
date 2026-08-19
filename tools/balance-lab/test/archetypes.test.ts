import { RULESET_V1, validateDefenseGraph } from "@payload/sim";
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

describe("VIRUS_ARCHETYPES", () => {
  it("every virus has exactly one movement block and at least one logic block", () => {
    for (const virus of VIRUS_ARCHETYPES) {
      expect(virus.virus.movement.kind).toBeTruthy();
      expect(virus.virus.blocks.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate archetype names", () => {
    expect(new Set(VIRUS_ARCHETYPES.map((virus) => virus.name)).size).toBe(VIRUS_ARCHETYPES.length);
  });
});

import { describe, expect, it } from "vitest";
import { getDetectHoneypotConfig } from "../../src/blocks/detect-honeypot.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getDetectHoneypotConfig", () => {
  it("matches docs/RULESET.md §4.1", () => {
    expect(getDetectHoneypotConfig(1)).toEqual({ tier: 1, radiusHops: 1, seesDisguise: false });
    expect(getDetectHoneypotConfig(3)).toEqual({ tier: 3, radiusHops: 2, seesDisguise: true });
  });
});

describe("Detect Honeypot — engine integration", () => {
  function graphWithHoneypotTier(tier: 1 | 2 | 3): DefenseGraph {
    return {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "honeypot", tier },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 200 },
        { from: 2, to: 3, lengthDu: 200 },
        { from: 3, to: 4, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
  }
  function inputWithBlocks(graph: DefenseGraph, blocks: BattleInput["virus"]["blocks"]): BattleInput {
    return { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks }, defense: graph };
  }

  it("without the block, a plain (tier I) Honeypot is lethal", () => {
    const log = simulate(inputWithBlocks(graphWithHoneypotTier(1), []));
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]).toMatchObject({ type: "virus-died" });
  });

  it("neutralizes a tier I Honeypot at any Detect Honeypot tier — the virus survives and reaches Core", () => {
    const log = simulate(inputWithBlocks(graphWithHoneypotTier(1), [{ kind: "detect-honeypot", tier: 1 }]));
    expect(log.result.winner).toBe("attacker");
  });

  it("a tier I Detect Honeypot cannot see through a tier II Honeypot's Core disguise — still lethal", () => {
    const log = simulate(inputWithBlocks(graphWithHoneypotTier(2), [{ kind: "detect-honeypot", tier: 1 }]));
    expect(log.result.winner).toBe("defender");
  });

  it("only a tier III Detect Honeypot sees through the disguise — the virus survives", () => {
    const log = simulate(inputWithBlocks(graphWithHoneypotTier(2), [{ kind: "detect-honeypot", tier: 3 }]));
    expect(log.result.winner).toBe("attacker");
  });
});

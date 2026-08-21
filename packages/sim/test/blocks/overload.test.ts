import { describe, expect, it } from "vitest";
import { getOverloadConfig } from "../../src/blocks/overload.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getOverloadConfig", () => {
  it("matches docs/RULESET.md §4.3", () => {
    expect(getOverloadConfig(1)).toEqual({ tier: 1, splashDamage: 150, radiusHops: 1 });
    expect(getOverloadConfig(3)).toEqual({ tier: 3, splashDamage: 320, radiusHops: 2 });
  });
});

describe("Overload — engine integration", () => {
  // entry(1)/(2) -> firewall A(3, tier I) -> core(4); A also connects to a side-branch
  // firewall B(5, tier I) that the virus never actually visits — B only takes damage via splash.
  function graph(bTier: 1 | 2 | 3 = 1): DefenseGraph {
    return {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
        { id: 5, type: "firewall", tier: bTier },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 200 },
        { from: 2, to: 3, lengthDu: 200 },
        { from: 3, to: 4, lengthDu: 200 },
        { from: 3, to: 5, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
  }

  it("splashes a neighboring Firewall (1 hop) the instant A is destroyed", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }, { kind: "overload", tier: 1 }] },
      defense: graph(),
    };
    const log = simulate(input);
    const destroyEvent = log.events.find((event) => event.type === "node-destroyed" && event.target === "3");
    expect(destroyEvent).toBeDefined();
    expect(log.events).toContainEqual({ tick: destroyEvent!.tick, type: "node-damaged", actor: "virus", target: "5", delta: -150 });
  });

  it("never splashes without an equipped Overload block", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }] },
      defense: graph(),
    };
    const log = simulate(input);
    expect(log.events.some((event) => event.type === "node-damaged" && event.target === "5")).toBe(false);
  });

  it("tier I/II splash (radius 1) never reaches a Firewall 2 hops away; only tier III (radius 2) does", () => {
    const twoHopGraph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
        { id: 7, type: "router" },
        { id: 5, type: "firewall", tier: 1 },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 200 },
        { from: 2, to: 3, lengthDu: 200 },
        { from: 3, to: 4, lengthDu: 200 },
        { from: 3, to: 7, lengthDu: 200 },
        { from: 7, to: 5, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
    const tier1Input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }, { kind: "overload", tier: 1 }] },
      defense: twoHopGraph,
    };
    const tier3Input: BattleInput = { ...tier1Input, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }, { kind: "overload", tier: 3 }] } };

    expect(simulate(tier1Input).events.some((event) => event.type === "node-damaged" && event.target === "5")).toBe(false);
    expect(simulate(tier3Input).events.some((event) => event.type === "node-damaged" && event.target === "5" && event.delta === -320)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { getBruteForceDamagePerTick } from "../../src/blocks/brute-force.js";
import { simulate } from "../../src/engine.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getBruteForceDamagePerTick", () => {
  it("matches docs/RULESET.md §4.3", () => {
    expect(getBruteForceDamagePerTick(1)).toBe(40);
    expect(getBruteForceDamagePerTick(2)).toBe(60);
    expect(getBruteForceDamagePerTick(3)).toBe(85);
  });
});

describe("Brute Force — engine integration", () => {
  // entry(1)/(2) --200du--> firewall I(3) --200du--> core(4).
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "firewall", tier: 1 },
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

  it("adds its per-tick damage on top of the passive drain (15 + 40 = 55/tick for tier I)", () => {
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }] }, defense: graph };
    const log = simulate(input);
    expect(log.events).toContainEqual(expect.objectContaining({ type: "node-damaged", target: "3", delta: -55 }));
  });

  it("breaks the Firewall faster than passive drain alone (500hp / 50/tick = 10 ticks vs 50 ticks unarmed)", () => {
    const withBlock: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "brute-force", tier: 1 }] }, defense: graph };
    const withoutBlock: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph };
    const destroyTick = (log: ReturnType<typeof simulate>) => log.events.find((event) => event.type === "node-destroyed" && event.target === "3")?.tick;
    expect(destroyTick(simulate(withBlock))).toBeLessThan(destroyTick(simulate(withoutBlock)) ?? Infinity);
  });
});

import { describe, expect, it } from "vitest";
import { getScanAheadConfig } from "../../src/blocks/scan-ahead.js";
import { simulate } from "../../src/engine.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getScanAheadConfig", () => {
  it("matches docs/RULESET.md §4.1", () => {
    expect(getScanAheadConfig(1)).toEqual({ tier: 1, radiusHops: 1, revealsTraps: false });
    expect(getScanAheadConfig(3)).toEqual({ tier: 3, radiusHops: 2, revealsTraps: true });
  });
});

describe("Scan Ahead — engine integration (tier III reveals Trap for Backtrack)", () => {
  // A(3) sits between the entries and a fork: a Trap(6) 1 hop directly on the shortest route to
  // core(4), or a detour via router(5) that avoids it. Backtrack only takes the detour if it
  // knows the Trap is there.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" }, // A
      { id: 6, type: "trap", tier: 1 },
      { id: 5, type: "router" },
      { id: 4, type: "core" },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 200 },
      { from: 2, to: 3, lengthDu: 200 },
      { from: 3, to: 6, lengthDu: 200 },
      { from: 6, to: 4, lengthDu: 200 },
      { from: 3, to: 5, lengthDu: 500 },
      { from: 5, to: 4, lengthDu: 500 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100,
  };

  it("without Scan Ahead III, Backtrack walks straight into the (undetected) Trap", () => {
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "backtrack" }, blocks: [] }, defense: graph };
    const log = simulate(input);
    expect(log.events).toContainEqual(expect.objectContaining({ type: "virus-damaged", actor: "6" }));
  });

  it("with Scan Ahead III equipped, Backtrack detours around the revealed Trap", () => {
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "backtrack" }, blocks: [{ kind: "scan-ahead", tier: 3 }] }, defense: graph };
    const log = simulate(input);
    expect(log.events.some((event) => event.type === "virus-damaged" && event.actor === "6")).toBe(false);
    expect(log.events).toContainEqual(expect.objectContaining({ type: "virus-entered-node", target: "5" }));
  });
});

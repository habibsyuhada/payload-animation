import { describe, expect, it } from "vitest";
import { getSelfRepairHealPerTick } from "../../src/blocks/self-repair.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getSelfRepairHealPerTick", () => {
  it("matches docs/RULESET.md §4.5", () => {
    expect(getSelfRepairHealPerTick(1)).toBe(5);
    expect(getSelfRepairHealPerTick(2)).toBe(8);
    expect(getSelfRepairHealPerTick(3)).toBe(12);
  });
});

describe("Self Repair — engine integration", () => {
  // entry(1)/(2) -> router(3) -> ICE Sentry(5) on a side-branch (hits once then the virus moves
  // out of range) -> core(4). Integrity should climb back up during the long unharmed core drain.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" },
      { id: 4, type: "core" },
      { id: 5, type: "ice-sentry", tier: 1 },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 200 },
      { from: 2, to: 3, lengthDu: 200 },
      { from: 3, to: 4, lengthDu: 200 },
      { from: 3, to: 5, lengthDu: 200 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 1000,
  };
  const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "self-repair", tier: 3 }] }, defense: graph };

  it("emits virus-repaired events and Integrity trends back up after taking damage", () => {
    const log = simulate(input);
    const repaired = log.events.filter((event) => event.type === "virus-repaired");
    expect(repaired.length).toBeGreaterThan(0);
    expect(repaired.every((event) => event.delta === 12)).toBe(true);
  });

  it("never repairs on a tick the virus took damage, or while occupying a Breach node", () => {
    const log = simulate(input);
    const damagedTicks = new Set(log.events.filter((event) => event.type === "virus-damaged").map((event) => event.tick));
    const repairedTicks = log.events.filter((event) => event.type === "virus-repaired").map((event) => event.tick);
    expect(repairedTicks.some((tick) => damagedTicks.has(tick))).toBe(false);
    // core is occupied from its arrival tick onward for the rest of this battle (coreHp 1000
    // never fully drains within a short test window) — no repair ticks should land there either.
    const coreArrivalTick = log.events.find((event) => event.type === "virus-entered-node" && event.target === "4")!.tick;
    expect(repairedTicks.some((tick) => tick >= coreArrivalTick)).toBe(false);
  });
});

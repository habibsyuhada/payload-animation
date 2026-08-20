import { describe, expect, it } from "vitest";
import { simulate } from "../../src/simulate.js";
import { honeypotIsLethal } from "../../src/nodes/honeypot.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("honeypotIsLethal", () => {
  it("is lethal when neither a detector nor a decoy charge is present (S1.4's only reachable case — Sensor/Utility blocks don't exist until S1.5)", () => {
    expect(honeypotIsLethal(false, false)).toBe(true);
  });

  it("is not lethal with Detect Honeypot active", () => {
    expect(honeypotIsLethal(true, false)).toBe(false);
  });

  it("is not lethal with a Sacrifice Decoy charge available", () => {
    expect(honeypotIsLethal(false, true)).toBe(false);
  });
});

describe("Honeypot — engine integration", () => {
  // entry(1)/(2) --200du--> honeypot I(3) --200du--> core(4).
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "honeypot", tier: 1 },
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
  const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph };

  it("kills the virus exactly one tick after arrival, per RULESET.md §5.1's 'di tick berikutnya'", () => {
    const log = simulate(input);
    expect(log.result.winner).toBe("defender");
    // arrives tick 4 -> dies tick 5, not tick 4.
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 4, type: "virus-entered-node", target: "3" }));
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 5, type: "virus-died" });
  });

  it("blocks movement during the 1-tick gap — no edge departure is ever recorded between arrival and death", () => {
    const log = simulate(input);
    // only 2 virus-entered-node events total: the entry, and the honeypot. Core is never reached.
    expect(log.events.filter((event) => event.type === "virus-entered-node")).toHaveLength(2);
  });

  it("zeroes Integrity outright (full remaining HP is dealt as damage), not a fixed damage number", () => {
    const log = simulate(input);
    expect(log.result.score.integrityRatioPermille).toBe(0);
    const killEvent = log.events.find((event) => event.type === "virus-damaged" && event.actor === "3");
    expect(killEvent).toMatchObject({ delta: -1000 });
  });
});

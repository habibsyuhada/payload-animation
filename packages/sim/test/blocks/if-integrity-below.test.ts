import { describe, expect, it } from "vitest";
import { evaluateIfIntegrityBelow } from "../../src/blocks/if-integrity-below.js";
import { simulate } from "../../src/engine.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("evaluateIfIntegrityBelow", () => {
  it("is true when Integrity is below the threshold", () => {
    expect(evaluateIfIntegrityBelow(400, 500)).toBe(true);
  });

  it("is false at or above the threshold", () => {
    expect(evaluateIfIntegrityBelow(500, 500)).toBe(false);
    expect(evaluateIfIntegrityBelow(600, 500)).toBe(false);
  });

  it("defaults to RULESET.md §4.2's tier-I 500‰ (50%) threshold when none is given", () => {
    expect(evaluateIfIntegrityBelow(499)).toBe(true);
    expect(evaluateIfIntegrityBelow(500)).toBe(false);
  });
});

describe("IF Integrity < X% — engine integration (gates the following Exploit block)", () => {
  // entry(1)/(2) --200du--> firewall I(3) --200du--> core(4). ICE Sentry(5) hits every 4 ticks
  // to whittle Integrity down under the threshold before Exploit's condition can fire.
  function graph(): DefenseGraph {
    return {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
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
      coreHp: 100,
    };
  }

  it("Exploit's one-shot damage never appears while gated by a condition that's false on arrival", () => {
    // Integrity is still 1000 (full) at the moment of Firewall arrival, so "IF Integrity < 90%"
    // is false right then — Exploit (which only ever fires on the arrival tick) never fires.
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 2,
      virus: {
        movement: { kind: "shortest-path" },
        blocks: [
          { kind: "if-integrity-below", tier: 1, integrityThresholdPermille: 900 },
          { kind: "exploit", tier: 1 },
        ],
      },
      defense: graph(),
    };
    const log = simulate(input);
    expect(log.events.some((event) => event.type === "node-destroyed" && event.target === "3")).toBe(false);
  });

  it("an ungated Exploit (no preceding condition) always fires on arrival regardless of Integrity", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 2,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "exploit", tier: 1 }] },
      defense: graph(),
    };
    const log = simulate(input);
    // firewall I has 500 HP; exploit I deals 250 one-shot on arrival, on top of the passive drain.
    expect(log.events).toContainEqual(expect.objectContaining({ type: "node-damaged", target: "3", delta: -260 }));
  });
});

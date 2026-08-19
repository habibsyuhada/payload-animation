import { describe, expect, it } from "vitest";
import { simulate } from "../../src/engine.js";
import { resolveCoreTick } from "../../src/nodes/core.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("resolveCoreTick", () => {
  it("drains 15 HP passively, never counters back", () => {
    expect(resolveCoreTick(100)).toEqual({ remainingHp: 85, destroyed: false });
  });

  it("floors at 0 and reports destroyed", () => {
    expect(resolveCoreTick(5)).toEqual({ remainingHp: 0, destroyed: true });
  });

  it("is a pure function of currentHp — same input always drains the same amount", () => {
    expect(resolveCoreTick(1800)).toEqual(resolveCoreTick(1800));
  });
});

describe("Core — engine integration", () => {
  function graphWithCoreHp(coreHp: number): DefenseGraph {
    return {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 200 },
        { from: 2, to: 3, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 3,
      coreHp,
    };
  }
  function inputWithCoreHp(coreHp: number): BattleInput {
    return { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graphWithCoreHp(coreHp) };
  }

  it("wins for the attacker exactly ceil(coreHp/15) drain ticks after arrival", () => {
    // arrives tick 4 (200du @ 50du/tick), then ceil(100/15)=7 drain ticks -> wins at tick 10.
    const log = simulate(inputWithCoreHp(100));
    expect(log.result.winner).toBe("attacker");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 10, type: "battle-won" });
  });

  it("never counters the virus — Integrity stays full the whole battle", () => {
    const log = simulate(inputWithCoreHp(100));
    expect(log.result.score.integrityRatioPermille).toBe(1000);
    expect(log.events.some((event) => event.type === "virus-damaged")).toBe(false);
  });

  it("reports a partial coreRatioPermille when the timer runs out before Core is destroyed", () => {
    // absurdly large coreHp so 1200 ticks of drain (15/tick = 18000 max) leaves it well short of 0.
    const log = simulate(inputWithCoreHp(100_000));
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 1200, type: "battle-timeout" });
    // drained (1200 - 4 arrival ticks) * 15 = 17940 out of 100000
    expect(log.result.score.coreRatioPermille).toBe(Math.floor(((100_000 - 17940) * 1000) / 100_000));
  });
});

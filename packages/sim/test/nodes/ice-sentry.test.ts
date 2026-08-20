import { describe, expect, it } from "vitest";
import { simulate } from "../../src/simulate.js";
import { effectiveAccuracyPermille, getIceSentryConfig, rollIceSentryHit } from "../../src/nodes/ice-sentry.js";
import type { Rng } from "../../src/rng.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

function fakeRng(nextIntValue: number): Rng {
  return {
    seed: 0,
    nextUint32: () => {
      throw new Error("not used by rollIceSentryHit");
    },
    nextInt: () => nextIntValue,
  };
}

describe("getIceSentryConfig", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(getIceSentryConfig(1)).toEqual({ tier: 1, radiusHops: 1, fireIntervalTicks: 4, damage: 60, accuracyPermille: 850 });
    expect(getIceSentryConfig(3)).toEqual({ tier: 3, radiusHops: 2, fireIntervalTicks: 3, damage: 115, accuracyPermille: 900 });
  });
});

describe("rollIceSentryHit", () => {
  it("hits when the roll lands below accuracy", () => {
    expect(rollIceSentryHit(fakeRng(849), 850)).toBe(true);
  });

  it("misses when the roll lands at or above accuracy", () => {
    expect(rollIceSentryHit(fakeRng(850), 850)).toBe(false);
    expect(rollIceSentryHit(fakeRng(999), 850)).toBe(false);
  });
});

describe("effectiveAccuracyPermille", () => {
  it("adds the scanned bonus", () => {
    expect(effectiveAccuracyPermille(850, 150)).toBe(1000);
  });

  it("never exceeds 1000‰ (it's a probability)", () => {
    expect(effectiveAccuracyPermille(900, 250)).toBe(1000);
  });
});

describe("ICE Sentry — engine integration", () => {
  function graphWithIce(iceEdgeLength: number): DefenseGraph {
    // entry(1)/(2) -> router(3) -> core(4); ICE Sentry(5) hangs off router(3) at hop-distance 1.
    return {
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
        { from: 3, to: 4, lengthDu: 2000 }, // long dwell time in range so an 85%-accuracy shot lands
        { from: 3, to: 5, lengthDu: iceEdgeLength },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
  }
  function inputWithIce(iceEdgeLength: number, seed: number): BattleInput {
    return { rulesetVersion: "v1", seed, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graphWithIce(iceEdgeLength) };
  }

  it("hits the virus while it's within radius (router and the long edge to core are both 1 hop from the ICE node)", () => {
    const log = simulate(inputWithIce(200, 1));
    const hits = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "5");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.delta).toBe(-60);
    }
  });

  it("never fires on a virus that's out of radius", () => {
    // isolate the ICE Sentry on its own long branch, well beyond 1 hop of the entry/router/core.
    const graph = graphWithIce(200);
    const farGraph: DefenseGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 6, type: "router" }],
      edges: [{ from: 1, to: 3, lengthDu: 200 }, { from: 2, to: 3, lengthDu: 200 }, { from: 3, to: 4, lengthDu: 2000 }, { from: 3, to: 6, lengthDu: 200 }, { from: 6, to: 5, lengthDu: 200 }],
    };
    const log = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: farGraph });
    expect(log.events.some((event) => event.type === "virus-damaged" && event.actor === "5")).toBe(false);
  });

  it("respects its fire cooldown — consecutive hits are spaced by fireIntervalTicks", () => {
    const log = simulate(inputWithIce(200, 1));
    const hitTicks = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "5").map((event) => event.tick);
    for (let i = 1; i < hitTicks.length; i += 1) {
      expect(hitTicks[i]! - hitTicks[i - 1]!).toBeGreaterThanOrEqual(4);
    }
  });
});

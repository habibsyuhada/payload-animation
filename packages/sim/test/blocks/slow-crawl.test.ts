import { describe, expect, it } from "vitest";
import { getSlowCrawlConfig } from "../../src/blocks/slow-crawl.js";
import { simulate } from "../../src/simulate.js";
import type { DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getSlowCrawlConfig", () => {
  it("matches docs/RULESET.md §4.4", () => {
    expect(getSlowCrawlConfig(1)).toEqual({ tier: 1, speedMultiplierPermille: 700, iceAccuracyReductionPermille: 300 });
    expect(getSlowCrawlConfig(3)).toEqual({ tier: 3, speedMultiplierPermille: 800, iceAccuracyReductionPermille: 500 });
  });
});

describe("Slow Crawl — engine integration", () => {
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" },
      { id: 4, type: "core" },
      { id: 5, type: "ice-sentry", tier: 1 },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 1000 },
      { from: 2, to: 3, lengthDu: 1000 },
      { from: 3, to: 4, lengthDu: 200 },
      { from: 3, to: 5, lengthDu: 200 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100,
  };

  it("takes more ticks to cross the same edge (50 -> 35 DU/tick at tier I, 700‰)", () => {
    const plain = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph });
    const slowed = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "slow-crawl", tier: 1 }] }, defense: graph });
    const arrivalTick = (log: ReturnType<typeof simulate>) => log.events.find((event) => event.type === "virus-entered-node" && event.target === "3")?.tick;
    // 1000du @ 50du/tick = 20 ticks; 1000du @ 35du/tick = ceil(1000/35) = 29 ticks.
    expect(arrivalTick(plain)).toBe(20);
    expect(arrivalTick(slowed)).toBe(29);
  });

  it("reduces ICE Sentry accuracy against it — fewer (or equal) hits than the same battle unslowed", () => {
    const plain = simulate({ rulesetVersion: "v1", seed: 5, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph });
    const slowed = simulate({ rulesetVersion: "v1", seed: 5, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "slow-crawl", tier: 3 }] }, defense: graph });
    const hits = (log: ReturnType<typeof simulate>) => log.events.filter((event) => event.type === "virus-damaged" && event.actor === "5").length;
    expect(hits(slowed)).toBeLessThanOrEqual(hits(plain));
  });
});

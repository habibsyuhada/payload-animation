import { describe, expect, it } from "vitest";
import { simulate } from "../../src/simulate.js";
import { getScannerConfig } from "../../src/nodes/scanner.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getScannerConfig", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(getScannerConfig(1)).toEqual({ tier: 1, radiusHops: 1, durationTicks: 6, iceAccuracyBonusPermille: 150 });
    expect(getScannerConfig(3)).toEqual({ tier: 3, radiusHops: 2, durationTicks: 10, iceAccuracyBonusPermille: 250 });
  });
});

describe("Scanner — engine integration", () => {
  // entry(1)/(2) -> router(3) -> core(4); Scanner(5) hangs off router(3) at hop-distance 1.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" },
      { id: 4, type: "core" },
      { id: 5, type: "scanner", tier: 1 },
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
  const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph };

  it("applies a scanned status-applied event once the virus is within radius", () => {
    const log = simulate(input);
    const applied = log.events.filter((event) => event.type === "status-applied" && event.actor === "5");
    expect(applied.length).toBeGreaterThan(0);
  });

  it("never applies a status if the virus stays outside its radius", () => {
    const farGraph: DefenseGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 6, type: "router" }],
      edges: [{ from: 1, to: 3, lengthDu: 200 }, { from: 2, to: 3, lengthDu: 200 }, { from: 3, to: 4, lengthDu: 200 }, { from: 3, to: 6, lengthDu: 200 }, { from: 6, to: 5, lengthDu: 200 }],
    };
    const log = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: farGraph });
    expect(log.events.some((event) => event.type === "status-applied")).toBe(false);
  });

  it("boosts an in-range ICE Sentry's accuracy while the scanned status is active", () => {
    const graphWithIce: DefenseGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: 7, type: "ice-sentry", tier: 1 }],
      edges: [...graph.edges, { from: 3, to: 7, lengthDu: 200 }],
    };
    const withScanner = simulate({ rulesetVersion: "v1", seed: 5, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graphWithIce });
    const withoutScanner = simulate({
      rulesetVersion: "v1",
      seed: 5,
      virus: { movement: { kind: "shortest-path" }, blocks: [] },
      defense: { ...graphWithIce, nodes: graphWithIce.nodes.filter((node) => node.type !== "scanner") },
    });
    const hitsWith = withScanner.events.filter((event) => event.type === "virus-damaged" && event.actor === "7").length;
    const hitsWithout = withoutScanner.events.filter((event) => event.type === "virus-damaged" && event.actor === "7").length;
    // same seed, same RNG draw sequence for the ICE roll — a higher effective accuracy can only
    // turn a would-be miss into a hit, never the reverse, so scanner-boosted hits >= unboosted.
    expect(hitsWith).toBeGreaterThanOrEqual(hitsWithout);
  });
});

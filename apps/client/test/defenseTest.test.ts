import { EDGE_LENGTH_MIN_DU } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { replayLayoutFor, runDefenseTest, SEEDS_PER_VIRUS, toDefenseGraph } from "../src/logic/defenseTest.js";
import { LINK_RANGE_DU, type DefendNode } from "../src/state/defendStore.js";

/** Entry and Core alone, at the page's own starting distance — an open corridor. */
const OPEN_CORRIDOR: readonly DefendNode[] = [
  { id: 2, type: "entry", x: -120, y: 0 },
  { id: 1, type: "core", x: 120, y: 0 },
];

/**
 * The composition RULESET.md §9 records as beating all five virus archetypes 100% of the time:
 * two overlapping ICE Sentries plus a Scanner feeding a Firewall chokepoint. This is the case the
 * whole feature exists for — a graph that passes every structural check and is still unfair.
 */
const ICE_NEST: readonly DefendNode[] = [
  { id: 2, type: "entry", x: -240, y: 0 },
  { id: 3, type: "firewall", tier: 3, x: 0, y: 0 },
  { id: 4, type: "ice-sentry", tier: 2, x: 0, y: -120 },
  { id: 5, type: "ice-sentry", tier: 2, x: 0, y: 120 },
  { id: 6, type: "scanner", tier: 1, x: 120, y: 60 },
  { id: 1, type: "core", x: 240, y: 0 },
];

describe("toDefenseGraph", () => {
  it("carries node types, tiers and entry/core ids over to the sim's shape", () => {
    const graph = toDefenseGraph(ICE_NEST);
    expect(graph.coreNodeId).toBe(1);
    expect(graph.entryNodeIds).toEqual([2]);
    expect(graph.nodes.find((node) => node.id === 3)).toEqual({ id: 3, type: "firewall", tier: 3 });
    expect(graph.coreHp).toBeGreaterThan(0);
  });

  it("derives edges from the same link range the map draws, with on-screen distance as length", () => {
    const graph = toDefenseGraph(OPEN_CORRIDOR);
    expect(graph.edges).toEqual([{ from: 2, to: 1, lengthDu: 240 }]);
    expect(graph.edges[0]!.lengthDu).toBeLessThanOrEqual(LINK_RANGE_DU);
    expect(graph.edges[0]!.lengthDu).toBeGreaterThanOrEqual(EDGE_LENGTH_MIN_DU);
  });

  it("produces no edge for nodes out of range of each other", () => {
    const graph = toDefenseGraph([
      { id: 2, type: "entry", x: 0, y: 0 },
      { id: 1, type: "core", x: LINK_RANGE_DU + 40, y: 0 },
    ]);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("runDefenseTest", () => {
  it("calls an open corridor too easy — every attacker walks in", () => {
    const report = runDefenseTest(OPEN_CORRIDOR);
    expect(report.verdict).toBe("too-easy");
    expect(report.breachCount).toBe(report.trials.length);
    expect(report.trials.every((trial) => trial.runs === SEEDS_PER_VIRUS)).toBe(true);
  });

  it("calls the ICE Nest impenetrable — nothing in the gauntlet ever gets through", () => {
    const report = runDefenseTest(ICE_NEST);
    expect(report.verdict).toBe("impenetrable");
    expect(report.breachCount).toBe(0);
    expect(report.trials.every((trial) => trial.wins === 0)).toBe(true);
  });

  it("still reports structurally invalid layouts rather than refusing to simulate them", () => {
    // One Entry where the ruleset wants two — the page's own starting layout.
    const report = runDefenseTest(OPEN_CORRIDOR);
    expect(report.validation.valid).toBe(false);
    expect(report.validation.errors.some((error) => error.code === "wrong-entry-count")).toBe(true);
    expect(report.trials).not.toHaveLength(0);
  });

  it("is deterministic — the same layout produces the same verdict and the same showcase battle", () => {
    const first = runDefenseTest(ICE_NEST);
    const second = runDefenseTest(ICE_NEST);
    expect(second.verdict).toBe(first.verdict);
    expect(second.showcase.showcase.input.seed).toBe(first.showcase.showcase.input.seed);
    expect(second.showcase.showcase.result.score.value).toBe(first.showcase.showcase.result.score.value);
  });

  it("showcases a winning battle when there is one, and the closest call when there isn't", () => {
    expect(runDefenseTest(OPEN_CORRIDOR).showcase.showcase.result.winner).toBe("attacker");
    const stonewall = runDefenseTest(ICE_NEST);
    expect(stonewall.showcase.showcaseWon).toBe(false);
    expect(stonewall.showcase.showcase.result.winner).toBe("defender");
  });
});

describe("replayLayoutFor", () => {
  it("fits every node inside the replay canvas box", () => {
    const layout = replayLayoutFor(ICE_NEST, 320, 240);
    const points = Object.values(layout.positions);
    expect(points).toHaveLength(ICE_NEST.length);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(320);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(240);
    }
  });

  it("keeps the world's proportions — a symmetric layout stays symmetric", () => {
    const layout = replayLayoutFor(ICE_NEST, 320, 240);
    const above = layout.positions[4]!;
    const below = layout.positions[5]!;
    expect(above.x).toBeCloseTo(below.x, 5);
    expect(Math.abs(above.y - below.y)).toBeGreaterThan(0);
  });
});

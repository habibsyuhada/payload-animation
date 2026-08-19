import { describe, expect, it } from "vitest";
import { MOVEMENT_ALGORITHMS } from "../src/movement.js";
import { createRng } from "../src/rng.js";
import type { DefenseGraph, DefenseNode } from "../src/types.js";

/**
 * A(3) has two routes to core(6): direct A-core (2000 DU, 1 hop) vs A-B-C-core (500x3=1500 DU,
 * 3 hops). Distance-weighted Shortest Path/Backtrack must prefer the indirect route — it's
 * shorter in total DU even though it's more hops (RULESET.md §3).
 */
function distanceVsHopGraph(): DefenseGraph {
  const nodes: DefenseNode[] = [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "router" },
    { id: 5, type: "router" },
    { id: 6, type: "core" },
  ];
  return {
    nodes,
    edges: [
      { from: 1, to: 3, lengthDu: 500 },
      { from: 2, to: 3, lengthDu: 500 },
      { from: 3, to: 4, lengthDu: 500 },
      { from: 4, to: 5, lengthDu: 500 },
      { from: 5, to: 6, lengthDu: 500 },
      { from: 3, to: 6, lengthDu: 2000 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 6,
  };
}

function diamondGraph(): DefenseGraph {
  const nodes: DefenseNode[] = [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 10, type: "router" }, // X
    { id: 11, type: "router" }, // Y
    { id: 4, type: "core" },
  ];
  return {
    nodes,
    edges: [
      { from: 1, to: 3, lengthDu: 500 },
      { from: 2, to: 3, lengthDu: 500 },
      { from: 3, to: 10, lengthDu: 500 },
      { from: 3, to: 11, lengthDu: 500 },
      { from: 10, to: 4, lengthDu: 500 },
      { from: 11, to: 4, lengthDu: 500 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
  };
}

describe("shortest-path movement", () => {
  it("prefers the route with less total DU distance, even when it has more hops", () => {
    const graph = distanceVsHopGraph();
    const decision = MOVEMENT_ALGORITHMS["shortest-path"](3, {
      graph,
      rng: createRng(1),
      triedEdgesFromNode: new Map(),
      knownHazardNodeIds: new Set(),
    });
    expect(decision).toEqual({ toNodeId: 4 }); // heads into the B-C-core route (1500 DU), not the direct 2000 DU edge
  });

  it("returns null when already at core (nowhere left to go)", () => {
    const graph = distanceVsHopGraph();
    const decision = MOVEMENT_ALGORITHMS["shortest-path"](6, {
      graph,
      rng: createRng(1),
      triedEdgesFromNode: new Map(),
      knownHazardNodeIds: new Set(),
    });
    expect(decision).toBeNull();
  });
});

describe("backtrack movement", () => {
  it("matches shortest-path when no hazards are known (S1.3: Sensor blocks don't exist yet)", () => {
    const graph = distanceVsHopGraph();
    const ctx = { graph, rng: createRng(1), triedEdgesFromNode: new Map(), knownHazardNodeIds: new Set<number>() };
    expect(MOVEMENT_ALGORITHMS.backtrack(3, ctx)).toEqual(MOVEMENT_ALGORITHMS["shortest-path"](3, ctx));
  });

  it("routes around a known hazard node", () => {
    const graph = diamondGraph();
    const ctx = { graph, rng: createRng(1), triedEdgesFromNode: new Map(), knownHazardNodeIds: new Set<number>([10]) };
    expect(MOVEMENT_ALGORITHMS.backtrack(3, ctx)).toEqual({ toNodeId: 11 });
  });

  it("falls back to the unrestricted path if avoiding hazards would strand the virus", () => {
    // both routes to core pass through node 10 here (11 is a dead end), so avoiding 10 is impossible.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
        { id: 10, type: "router" },
        { id: 11, type: "router" },
        { id: 4, type: "core" },
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 500 },
        { from: 2, to: 3, lengthDu: 500 },
        { from: 3, to: 10, lengthDu: 500 },
        { from: 3, to: 11, lengthDu: 500 },
        { from: 10, to: 4, lengthDu: 500 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
    };
    const ctx = { graph, rng: createRng(1), triedEdgesFromNode: new Map(), knownHazardNodeIds: new Set<number>([10]) };
    expect(MOVEMENT_ALGORITHMS.backtrack(3, ctx)).toEqual({ toNodeId: 10 });
  });
});

describe("random-walk movement", () => {
  it("visits every neighbor of a node before repeating any of them", () => {
    const graph = diamondGraph();
    const triedEdgesFromNode = new Map<number, Set<number>>();
    const rng = createRng(123);
    const picks = new Set<number>();
    // node 3 has exactly 4 neighbors: 1, 2, 10, 11 — the first 4 picks must be a permutation of those.
    for (let i = 0; i < 4; i += 1) {
      const decision = MOVEMENT_ALGORITHMS["random-walk"](3, { graph, rng, triedEdgesFromNode, knownHazardNodeIds: new Set() });
      expect(decision).not.toBeNull();
      expect(picks.has(decision!.toNodeId)).toBe(false);
      picks.add(decision!.toNodeId);
    }
    expect(picks).toEqual(new Set([1, 2, 10, 11]));

    // 5th pick: every edge from node 3 has now been tried once — buntu resets, revisiting is allowed.
    const fifth = MOVEMENT_ALGORITHMS["random-walk"](3, { graph, rng, triedEdgesFromNode, knownHazardNodeIds: new Set() });
    expect(fifth).not.toBeNull();
    expect([1, 2, 10, 11]).toContain(fifth!.toNodeId);
  });

  it("returns null for an isolated node with no edges", () => {
    const graph = diamondGraph();
    const decision = MOVEMENT_ALGORITHMS["random-walk"](999, {
      graph,
      rng: createRng(1),
      triedEdgesFromNode: new Map(),
      knownHazardNodeIds: new Set(),
    });
    expect(decision).toBeNull();
  });

  it("is deterministic: same seed and same call sequence produce the same picks", () => {
    const graph = diamondGraph();
    const run = () => {
      const rng = createRng(42);
      const triedEdgesFromNode = new Map<number, Set<number>>();
      return Array.from({ length: 6 }, () => MOVEMENT_ALGORITHMS["random-walk"](3, { graph, rng, triedEdgesFromNode, knownHazardNodeIds: new Set() })?.toNodeId);
    };
    expect(run()).toEqual(run());
  });
});

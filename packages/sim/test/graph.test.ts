import { describe, expect, it } from "vitest";
import { buildAdjacency, isReachable, shortestPath, validateDefenseGraph } from "../src/graph.js";
import { RULESET_V1 } from "../src/ruleset.js";
import { RULESET_V2 } from "../src/ruleset-v2.js";
import type { DefenseGraph, DefenseNode } from "../src/types.js";

/**
 * entry(1) --- router(3) --- firewall I(4) --- core(5)
 * entry(2) ---/
 * Total node cost: router(1) + firewall I(3) = 4, well within tier-1's 20pt budget.
 */
function baseNodes(): DefenseNode[] {
  return [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "firewall", tier: 1 },
    { id: 5, type: "core" },
  ];
}

function baseGraph(overrides: Partial<DefenseGraph> = {}): DefenseGraph {
  return {
    nodes: baseNodes(),
    edges: [
      { from: 1, to: 3, lengthDu: 500 },
      { from: 2, to: 3, lengthDu: 500 },
      { from: 3, to: 4, lengthDu: 500 },
      { from: 4, to: 5, lengthDu: 500 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 5,
    coreHp: 1800, // tier-1 (RULESET.md §5.2) — matches validateDefenseGraph(..., RULESET_V1, 1) below
    ...overrides,
  };
}

describe("buildAdjacency", () => {
  it("is undirected and ignores edges referencing unknown nodes", () => {
    const graph = baseGraph({ edges: [{ from: 1, to: 3, lengthDu: 500 }, { from: 1, to: 99, lengthDu: 500 }] });
    const adjacency = buildAdjacency(graph);
    expect(adjacency.get(1)).toEqual([3]);
    expect(adjacency.get(3)).toEqual([1]);
  });
});

describe("shortestPath / isReachable", () => {
  it("finds the hop-count-shortest path between two connected nodes", () => {
    const graph = baseGraph();
    expect(shortestPath(graph, 1, 5)).toEqual([1, 3, 4, 5]);
    expect(isReachable(graph, 1, 5)).toBe(true);
  });

  it("returns null / false for unreachable nodes", () => {
    const graph = baseGraph({ edges: [{ from: 1, to: 3, lengthDu: 500 }] });
    expect(shortestPath(graph, 2, 5)).toBeNull();
    expect(isReachable(graph, 2, 5)).toBe(false);
  });

  it("returns a single-node path when from === to", () => {
    expect(shortestPath(baseGraph(), 5, 5)).toEqual([5]);
  });
});

describe("validateDefenseGraph — valid cases", () => {
  it("accepts a minimal well-formed graph within budget", () => {
    const result = validateDefenseGraph(baseGraph(), RULESET_V1, 1);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe("validateDefenseGraph — invalid cases", () => {
  it("flags an entry with no path to core", () => {
    const graph = baseGraph({ edges: [{ from: 1, to: 3, lengthDu: 500 }, { from: 3, to: 4, lengthDu: 500 }, { from: 4, to: 5, lengthDu: 500 }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unreachable-entry", nodeId: 2 }));
  });

  it("flags wrong entry count (too few entry-type nodes)", () => {
    const graph = baseGraph({
      nodes: [{ id: 1, type: "entry" }, { id: 3, type: "router" }, { id: 5, type: "core" }],
      edges: [{ from: 1, to: 3, lengthDu: 500 }, { from: 3, to: 5, lengthDu: 500 }],
      entryNodeIds: [1],
    });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "wrong-entry-count" }));
  });

  it("flags entryNodeIds referencing a non-entry node", () => {
    const graph = baseGraph({ entryNodeIds: [1, 3] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "entry-id-mismatch", nodeId: 3 }));
  });

  it("flags missing core node", () => {
    const graph = baseGraph({ nodes: baseNodes().filter((node) => node.type !== "core") });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "wrong-core-count" }));
  });

  it("flags duplicate core nodes", () => {
    const graph = baseGraph({ nodes: [...baseNodes(), { id: 6, type: "core" }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "wrong-core-count" }));
  });

  it("flags coreNodeId not matching the actual core-type node", () => {
    const graph = baseGraph({ coreNodeId: 3 });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "core-id-mismatch", nodeId: 3 }));
  });

  it("flags duplicate node ids", () => {
    const graph = baseGraph({ nodes: [...baseNodes(), { id: 4, type: "router" }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "duplicate-node-id", nodeId: 4 }));
  });

  it("flags an edge referencing a node that doesn't exist", () => {
    const graph = baseGraph({ edges: [...baseGraph().edges, { from: 4, to: 999, lengthDu: 500 }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid-edge-reference" }));
  });

  it("flags a self-loop edge", () => {
    const graph = baseGraph({ edges: [...baseGraph().edges, { from: 3, to: 3, lengthDu: 500 }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "self-loop-edge", nodeId: 3 }));
  });

  it.each([100, 2001])("flags an edge length %d DU outside [200, 2000]", (lengthDu) => {
    const graph = baseGraph({ edges: [{ from: 1, to: 3, lengthDu }, { from: 2, to: 3, lengthDu: 500 }, { from: 3, to: 4, lengthDu: 500 }, { from: 4, to: 5, lengthDu: 500 }] });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "edge-length-out-of-range" }));
  });

  it("flags total node cost exceeding the account tier's defense budget", () => {
    const graph = baseGraph({
      nodes: [
        ...baseNodes(),
        { id: 6, type: "ice-sentry", tier: 3 },
        { id: 7, type: "ice-sentry", tier: 3 },
        { id: 8, type: "ice-sentry", tier: 3 },
      ],
      edges: [...baseGraph().edges, { from: 3, to: 6, lengthDu: 500 }, { from: 3, to: 7, lengthDu: 500 }, { from: 3, to: 8, lengthDu: 500 }],
    });
    // cost: router(1) + firewall I(3) + 3x ice-sentry III(9) = 31 > tier-1 budget of 20
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "budget-exceeded" }));
  });

  it("accepts a graph whose total cost lands exactly on the budget boundary", () => {
    // cost: router(1) + firewall I(3) + 3x trap III(5) + router(1) = 20, tier-1's exact budget.
    const graph = baseGraph({
      nodes: [...baseNodes(), { id: 6, type: "trap", tier: 3 }, { id: 7, type: "trap", tier: 3 }, { id: 8, type: "trap", tier: 3 }, { id: 9, type: "router" }],
      edges: [
        ...baseGraph().edges,
        { from: 3, to: 6, lengthDu: 500 },
        { from: 3, to: 7, lengthDu: 500 },
        { from: 3, to: 8, lengthDu: 500 },
        { from: 3, to: 9, lengthDu: 500 },
      ],
    });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects the same graph one point over the budget boundary", () => {
    const graph = baseGraph({
      nodes: [
        ...baseNodes(),
        { id: 6, type: "trap", tier: 3 },
        { id: 7, type: "trap", tier: 3 },
        { id: 8, type: "trap", tier: 3 },
        { id: 9, type: "router" },
        { id: 10, type: "router" },
      ],
      edges: [
        ...baseGraph().edges,
        { from: 3, to: 6, lengthDu: 500 },
        { from: 3, to: 7, lengthDu: 500 },
        { from: 3, to: 8, lengthDu: 500 },
        { from: 3, to: 9, lengthDu: 500 },
        { from: 3, to: 10, lengthDu: 500 },
      ],
    });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "budget-exceeded" }));
  });

  it("flags coreHp that doesn't match the account tier's fixed value", () => {
    const graph = baseGraph({ coreHp: 999 });
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "core-hp-mismatch" }));
  });

  it("accepts coreHp matching a different account tier's value when validated at that tier", () => {
    const graph = baseGraph({ coreHp: 2200 }); // tier-3's coreHp (RULESET.md §5.2)
    const result = validateDefenseGraph(graph, RULESET_V1, 3);
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

/**
 * 8.1d: validateDefenseGraph is now version-aware via topologyRulesFor(ruleset), and a node with
 * no price under the given ruleset version is REPORTED (unsupported-node-type), not thrown — that
 * used to be an uncaught exception from inside the cost-summing reduce (ADR 0007's "bug laten").
 */
describe("validateDefenseGraph — v2", () => {
  it("accepts the same v1-shaped graph under RULESET_V2 — topology is unchanged between versions", () => {
    const result = validateDefenseGraph(baseGraph(), RULESET_V2, 1);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("reports unsupported-node-type instead of throwing for a type this ruleset has no price for (e.g. malformed JSON from localStorage/a server)", () => {
    const graph = baseGraph({
      nodes: [...baseNodes(), { id: 6, type: "nonexistent-node-type" as DefenseNode["type"], tier: 1 }],
      edges: [...baseGraph().edges, { from: 3, to: 6, lengthDu: 500 }],
    });
    expect(() => validateDefenseGraph(graph, RULESET_V2, 1)).not.toThrow();
    const result = validateDefenseGraph(graph, RULESET_V2, 1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported-node-type", nodeId: 6 }));
  });

  it("still runs every other check on a graph with an unpriced node — one bad node doesn't mask the rest", () => {
    const graph = baseGraph({
      nodes: [...baseNodes(), { id: 6, type: "nonexistent-node-type" as DefenseNode["type"], tier: 1 }],
      edges: [...baseGraph().edges, { from: 3, to: 6, lengthDu: 500 }],
      coreHp: 999, // also wrong, independent of the unpriced node
    });
    const result = validateDefenseGraph(graph, RULESET_V2, 1);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported-node-type", nodeId: 6 }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "core-hp-mismatch" }));
  });

  it("excludes an unpriced node from the budget sum rather than letting it poison the total", () => {
    // router(1) + firewall I(3) = 4pt if the unpriced node is excluded; well within tier-1's 20pt budget.
    const graph = baseGraph({
      nodes: [...baseNodes(), { id: 6, type: "nonexistent-node-type" as DefenseNode["type"], tier: 1 }],
      edges: [...baseGraph().edges, { from: 3, to: 6, lengthDu: 500 }],
    });
    const result = validateDefenseGraph(graph, RULESET_V2, 1);
    expect(result.errors).not.toContainEqual(expect.objectContaining({ code: "budget-exceeded" }));
  });

  it("still rejects an unknown type under RULESET_V1 the same way (v1 was never affected by the crash)", () => {
    const graph = baseGraph({
      nodes: [...baseNodes(), { id: 6, type: "nonexistent-node-type" as DefenseNode["type"], tier: 1 }],
      edges: [...baseGraph().edges, { from: 3, to: 6, lengthDu: 500 }],
    });
    expect(() => validateDefenseGraph(graph, RULESET_V1, 1)).not.toThrow();
    const result = validateDefenseGraph(graph, RULESET_V1, 1);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsupported-node-type", nodeId: 6 }));
  });
});

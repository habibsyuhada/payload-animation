import { describe, expect, it } from "vitest";
import { simulate } from "../src/engine.js";
import type { BattleInput, BattleLog, DefenseGraph, DefenseNode } from "../src/types.js";

/**
 * S1.3 scope note (see docs/ADR/0001): no node combat or logic blocks exist yet, so every
 * scenario below deliberately uses only entry/router/core nodes — Firewall/ICE/Honeypot/
 * Scanner/Trap don't have real behavior until S1.4, and testing "through" them here would just
 * exercise Router-like pass-through, which is misleading to freeze as a golden log.
 */

function baseVirus(movementKind: BattleInput["virus"]["movement"]["kind"]): BattleInput["virus"] {
  return { movement: { kind: movementKind }, blocks: [] };
}

function assertPlausibleBattleLog(log: BattleLog, graph: DefenseGraph): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  expect(log.events.length).toBeGreaterThan(0);

  const first = log.events[0]!;
  expect(first.type).toBe("virus-entered-node");
  expect(graph.entryNodeIds).toContain(Number(first.target));

  let previousTick = -1;
  for (const event of log.events) {
    expect(event.tick).toBeGreaterThanOrEqual(previousTick);
    previousTick = event.tick;
    if (event.type === "virus-entered-node") {
      expect(nodeIds.has(Number(event.target))).toBe(true);
    }
  }

  const last = log.events[log.events.length - 1]!;
  if (log.result.winner === "attacker") {
    expect(last.type).toBe("battle-won");
  } else {
    expect(last.type).toBe("battle-timeout");
  }
}

describe("simulate — Scenario 1: Shortest Path, straight line", () => {
  // entry(1)/entry(2) --400du--> router(3) --600du--> core(4). Both entry edges are equal
  // length, so total ticks-to-win is identical no matter which entry the RNG selects.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" },
      { id: 4, type: "core" },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 400 },
      { from: 2, to: 3, lengthDu: 400 },
      { from: 3, to: 4, lengthDu: 600 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
  };
  const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: baseVirus("shortest-path"), defense: graph };

  it("reaches core in exactly 21 ticks regardless of which entry is chosen", () => {
    const log = simulate(input);
    expect(log.result.winner).toBe("attacker");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 21, type: "battle-won" });
    assertPlausibleBattleLog(log, graph);
  });

  it("matches the frozen golden log", () => {
    expect(simulate(input)).toMatchSnapshot();
  });

  it("is deterministic across repeated runs with the same seed", () => {
    expect(simulate(input)).toEqual(simulate(input));
  });
});

describe("simulate — Scenario 2: Random Walk, branching graph with a cycle", () => {
  // entry(1)-A(3), entry(2)-B(4), and A-B-C form a triangle, C connects to core(6). Random Walk
  // can wander back toward the entries before eventually finding Core.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" }, // A
      { id: 4, type: "router" }, // B
      { id: 5, type: "router" }, // C
      { id: 6, type: "core" },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 300 },
      { from: 2, to: 4, lengthDu: 300 },
      { from: 3, to: 4, lengthDu: 300 },
      { from: 3, to: 5, lengthDu: 300 },
      { from: 4, to: 5, lengthDu: 300 },
      { from: 5, to: 6, lengthDu: 300 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 6,
  };
  const input: BattleInput = { rulesetVersion: "v1", seed: 7, virus: baseVirus("random-walk"), defense: graph };

  it("produces a plausible, terminated battle log", () => {
    assertPlausibleBattleLog(simulate(input), graph);
  });

  it("matches the frozen golden log", () => {
    expect(simulate(input)).toMatchSnapshot();
  });

  it("is deterministic across repeated runs with the same seed", () => {
    expect(simulate(input)).toEqual(simulate(input));
  });
});

describe("simulate — Scenario 3: Backtrack, distance-weighted routing", () => {
  // A(3) can reach core(6) via a direct 2000du edge (1 hop) or via B-C (500x3=1500du, 3 hops).
  // Backtrack (== Shortest Path with no known hazards, S1.3) must take the shorter-DU indirect
  // route rather than the fewer-hop direct edge.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" }, // A
      { id: 4, type: "router" }, // B
      { id: 5, type: "router" }, // C
      { id: 6, type: "core" },
    ] satisfies DefenseNode[],
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
  const input: BattleInput = { rulesetVersion: "v1", seed: 3, virus: baseVirus("backtrack"), defense: graph };

  it("takes the shorter-DU indirect route (43 ticks) rather than the direct 2000du edge", () => {
    const log = simulate(input);
    expect(log.result.winner).toBe("attacker");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 43, type: "battle-won" });
    // 4 node-entries total: entry -> A -> B -> C -> core.
    expect(log.events.filter((event) => event.type === "virus-entered-node")).toHaveLength(5);
    assertPlausibleBattleLog(log, graph);
  });

  it("matches the frozen golden log", () => {
    expect(simulate(input)).toMatchSnapshot();
  });

  it("is deterministic across repeated runs with the same seed", () => {
    expect(simulate(input)).toEqual(simulate(input));
  });
});

describe("simulate — timeout", () => {
  it("defender wins if the virus cannot reach an unreachable core within the tick limit", () => {
    // Deliberately invalid topology (core unreachable from the entry) — simulate() trusts its
    // input per ADR 0001; validateDefenseGraph() is what should catch this before simulate() runs.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "core" },
      ] satisfies DefenseNode[],
      edges: [],
      entryNodeIds: [1, 2],
      coreNodeId: 3,
    };
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: baseVirus("shortest-path"), defense: graph };
    const log = simulate(input);
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 1200, type: "battle-timeout" });
  });
});

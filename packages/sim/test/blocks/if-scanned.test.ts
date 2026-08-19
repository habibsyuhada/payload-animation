import { describe, expect, it } from "vitest";
import { evaluateIfScanned } from "../../src/blocks/if-scanned.js";
import { simulate } from "../../src/engine.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("evaluateIfScanned", () => {
  it("is true while the current tick is before the scanned status expires", () => {
    expect(evaluateIfScanned(20, 15)).toBe(true);
  });

  it("is false once the status has expired, or if never applied", () => {
    expect(evaluateIfScanned(20, 20)).toBe(false);
    expect(evaluateIfScanned(null, 15)).toBe(false);
  });
});

describe("IF Scanned — engine integration (gates Brute Force to only apply while scanned)", () => {
  // entry(1)/(2) -> firewall I(3) -> core(4); Scanner(5) hangs off firewall(3) at hop-distance 1,
  // so the virus is scanned the instant it arrives at the firewall.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "firewall", tier: 1 },
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

  it("applies Brute Force damage once the virus is scanned", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "if-scanned", tier: 1 }, { kind: "brute-force", tier: 1 }] },
      defense: graph,
    };
    const log = simulate(input);
    // scanner and firewall are both hop-distance 1 from... scanner applies status same tick as
    // arrival (both in range immediately), so brute-force (40/tick) should show up alongside the
    // passive drain (10/tick) for -50 total on at least one node-damaged event against node 3.
    expect(log.events).toContainEqual(expect.objectContaining({ type: "node-damaged", target: "3", delta: -50 }));
  });

  it("never applies Brute Force damage without a Scanner in range to grant the status", () => {
    const noScanner: DefenseGraph = { ...graph, nodes: graph.nodes.filter((node) => node.type !== "scanner") };
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "if-scanned", tier: 1 }, { kind: "brute-force", tier: 1 }] },
      defense: noScanner,
    };
    const log = simulate(input);
    const firewallDamageEvents = log.events.filter((event) => event.type === "node-damaged" && event.target === "3");
    expect(firewallDamageEvents.every((event) => event.delta === -10)).toBe(true);
  });
});

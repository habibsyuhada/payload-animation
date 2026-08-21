import { describe, expect, it } from "vitest";
import { evaluateIfNodeType } from "../../src/blocks/if-node-type.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("evaluateIfNodeType", () => {
  it("is true when the current node's type is in the target set", () => {
    expect(evaluateIfNodeType("firewall", ["firewall"])).toBe(true);
  });

  it("is false for a type outside the target set, and for null (no current node)", () => {
    expect(evaluateIfNodeType("core", ["firewall"])).toBe(false);
    expect(evaluateIfNodeType(null, ["firewall"])).toBe(false);
  });

  it("defaults to RULESET.md §4.2's ['firewall'] target when none is given", () => {
    expect(evaluateIfNodeType("firewall")).toBe(true);
    expect(evaluateIfNodeType("core")).toBe(false);
  });

  it("tier III can target multiple node types at once", () => {
    expect(evaluateIfNodeType("core", ["firewall", "ice-sentry", "core"])).toBe(true);
  });
});

describe("IF Node = Firewall — engine integration (gates Exploit to fire only at the matching node)", () => {
  // entry(1)/(2) --200du--> firewall I(3) --200du--> core(4).
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "firewall", tier: 1 },
      { id: 4, type: "core" },
    ] satisfies DefenseNode[],
    edges: [
      { from: 1, to: 3, lengthDu: 200 },
      { from: 2, to: 3, lengthDu: 200 },
      { from: 3, to: 4, lengthDu: 200 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100,
  };

  it("fires Exploit at the Firewall it targets", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "if-node-type", tier: 1, targetNodeTypes: ["firewall"] }, { kind: "exploit", tier: 1 }] },
      defense: graph,
    };
    const log = simulate(input);
    expect(log.events).toContainEqual(expect.objectContaining({ type: "node-damaged", target: "3", delta: -265 }));
  });

  it("does not fire Exploit at Core when the condition targets only Firewall", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "if-node-type", tier: 1, targetNodeTypes: ["firewall"] }, { kind: "exploit", tier: 1 }] },
      defense: graph,
    };
    const log = simulate(input);
    // core's only damage should be the plain 15/tick passive drain (or less on the final
    // partial tick), never the -265 one-shot Exploit hit, since core != firewall.
    const coreDamageEvents = log.events.filter((event) => event.type === "node-damaged" && event.target === "4");
    expect(coreDamageEvents.every((event) => (event.delta ?? 0) >= -15)).toBe(true);
  });
});

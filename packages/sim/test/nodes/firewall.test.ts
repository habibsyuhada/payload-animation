import { describe, expect, it } from "vitest";
import { simulate } from "../../src/engine.js";
import { firewallMaxHp, resolveFirewallTick } from "../../src/nodes/firewall.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("firewallMaxHp", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(firewallMaxHp(1)).toBe(500);
    expect(firewallMaxHp(2)).toBe(800);
    expect(firewallMaxHp(3)).toBe(1200);
  });
});

describe("resolveFirewallTick", () => {
  it("drains 10 HP passively and still counters even while far from destroyed", () => {
    const result = resolveFirewallTick(500, 1);
    expect(result).toEqual({ remainingHp: 490, counterDamageToVirus: 20, destroyed: false });
  });

  it("floors at 0 HP and reports destroyed once drained past zero", () => {
    const result = resolveFirewallTick(5, 1);
    expect(result).toEqual({ remainingHp: 0, counterDamageToVirus: 20, destroyed: true });
  });

  it("uses the tier's own counter-damage figure", () => {
    expect(resolveFirewallTick(1200, 3).counterDamageToVirus).toBe(45);
  });
});

describe("Firewall — engine integration", () => {
  // entry(1)/(2) --200du--> firewall I(3) --200du--> core(4). Speed 50 -> arrives tick 4.
  // Firewall I: HP 500, passive drain 10/tick -> breaks after 50 ticks (tick 4..53), taking
  // 50 counter hits of 20 = 1000 total — exactly the virus's max Integrity. Without an Attack
  // block (S1.5), v1's numbers make this an exact dead heat: the virus dies the very tick the
  // Firewall would have broken. This is RULESET.md §9's open question, now confirmed by
  // simulation rather than by hand — a non-Attack virus cannot survive breaching any tier.
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
  const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph };

  it("blocks the virus at the Firewall and ends in a dead heat: virus dies the tick the Firewall breaks", () => {
    const log = simulate(input);
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 53, type: "virus-died" });
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 53, type: "node-destroyed", target: "3" }));
    // never reached the edge past the firewall
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.target === "4")).toBe(false);
  });

  it("counters every tick it's occupied — total damage dealt matches counterDamage × ticks-to-break", () => {
    const log = simulate(input);
    const counterHits = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "3");
    expect(counterHits).toHaveLength(50);
    expect(counterHits.reduce((sum, event) => sum + Math.abs(event.delta ?? 0), 0)).toBe(1000);
  });
});

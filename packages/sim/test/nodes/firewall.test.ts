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
  it("drains 15 HP passively and still counters even while far from destroyed", () => {
    const result = resolveFirewallTick(500, 1);
    expect(result).toEqual({ remainingHp: 485, counterDamageToVirus: 20, destroyed: false });
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
  // Firewall I: HP 500, passive drain 15/tick -> breaks after ceil(500/15)=34 ticks, taking
  // 34 counter hits of 20 = 680 total. That's comfortably under the virus's 1000 max Integrity
  // (per S1.7 balance-lab: BREACH_PASSIVE_DRAIN_V1 was raised from 10 to 15 specifically so a
  // non-Attack virus can survive a Tier I Firewall — see RULESET.md §9). Tier II/III remain
  // fatal without an Attack block; that part of the original S1.4 finding still holds.
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

  it("blocks the virus at the Firewall, but a Tier I Firewall is now survivable without an Attack block", () => {
    const log = simulate(input);
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 37, type: "node-destroyed", target: "3" }));
    expect(log.result.winner).toBe("attacker");
    // 320 Integrity left (1000 - 34*20) at the moment the Firewall breaks.
    const lastCounterHit = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "3").at(-1);
    expect(lastCounterHit).toMatchObject({ tick: 37 });
  });

  it("counters every tick it's occupied — total damage dealt matches counterDamage × ticks-to-break", () => {
    const log = simulate(input);
    const counterHits = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "3");
    expect(counterHits).toHaveLength(34);
    expect(counterHits.reduce((sum, event) => sum + Math.abs(event.delta ?? 0), 0)).toBe(680);
  });
});

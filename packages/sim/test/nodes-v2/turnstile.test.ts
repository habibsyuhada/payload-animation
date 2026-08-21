import { describe, expect, it } from "vitest";
import { getTurnstileConfigV2 } from "../../src/nodes-v2/turnstile.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInputV2, BattleLog, DefenseGraph, DefenseNode, SheetEvent } from "../../src/types.js";

describe("getTurnstileConfigV2", () => {
  it("matches docs/RULESET.md §14", () => {
    expect(getTurnstileConfigV2(1)).toEqual({ lockoutTicks: 40 });
    expect(getTurnstileConfigV2(2)).toEqual({ lockoutTicks: 70 });
    expect(getTurnstileConfigV2(3)).toEqual({ lockoutTicks: 110 });
  });

  it("locks out longer at higher tier", () => {
    expect(getTurnstileConfigV2(1).lockoutTicks).toBeLessThan(getTurnstileConfigV2(3).lockoutTicks);
  });
});

/**
 * Entry 1/2 -> gate(3) -> Core(4). `gate` is either a Turnstile or (control) a plain Router — same
 * topology either way, so any behavioral difference is the Turnstile's lockout, not the map.
 * Sheet: while AT an Entry, push forward to the gate (`move-toward-core`); everywhere else, try to
 * retreat to wherever the virus just came from (`move-back`). That oscillates entry<->gate forever
 * UNLESS something blocks it — and since the lockout is checked against the RESOLVED target
 * regardless of which action produced it (engine-v2.ts's post-filter), it blocks the FORWARD trip
 * back into the gate too, not just the backward one that names it. The Core is never actually
 * reached: from Entry the only next hop is the gate, one edge away.
 */
function gateGraph(gateType: "turnstile" | "router"): DefenseGraph {
  const gate: DefenseNode = gateType === "turnstile" ? { id: 3, type: "turnstile", tier: 1 } : { id: 3, type: "router" };
  return {
    nodes: [{ id: 1, type: "entry" }, { id: 2, type: "entry" }, gate, { id: 4, type: "core" }],
    edges: [
      { from: 1, to: 3, lengthDu: 300 },
      { from: 2, to: 3, lengthDu: 300 },
      { from: 3, to: 4, lengthDu: 300 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100_000,
  };
}

const OSCILLATE: SheetEvent[] = [
  { conditions: [{ kind: "node-here-is", targetNodeTypes: ["entry"] }], actions: [{ kind: "move-toward-core" }], children: [] },
  { conditions: [], actions: [{ kind: "move-back" }], children: [] },
];

function run(gateType: "turnstile" | "router"): BattleLog {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 3, virus: { events: OSCILLATE }, defense: gateGraph(gateType) };
  return simulate(input);
}

function ticksAt(log: BattleLog, eventType: "virus-entered-node" | "virus-departed-node", nodeId: string): number[] {
  return log.events.filter((event) => event.type === eventType && event.target === nodeId).map((event) => event.tick);
}

describe("Turnstile — engine integration", () => {
  it("blocks re-entry for the lockout window: no return to node 3 before departureTick + lockoutTicks", () => {
    const log = run("turnstile");
    const departureTick = ticksAt(log, "virus-departed-node", "3")[0]!;
    const returnTicks = ticksAt(log, "virus-entered-node", "3").slice(1); // [0] is the original arrival
    expect(returnTicks.length).toBeGreaterThan(0); // the lockout expires eventually — this is a window, not a permanent ban
    expect(returnTicks[0]!).toBeGreaterThanOrEqual(departureTick + 40); // tier I lockout (RULESET.md §14)
  });

  it("the same sheet on the same map returns almost immediately when the gate is a plain Router — proves it's the Turnstile, not the topology", () => {
    const log = run("router");
    const departureTick = ticksAt(log, "virus-departed-node", "3")[0]!;
    const returnTicks = ticksAt(log, "virus-entered-node", "3").slice(1);
    expect(returnTicks[0]!).toBeLessThan(departureTick + 40); // no lockout at all, so nowhere near tier I's 40-tick wait
  });
});

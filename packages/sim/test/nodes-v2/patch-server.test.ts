import { describe, expect, it } from "vitest";
import { getPatchServerConfigV2 } from "../../src/nodes-v2/patch-server.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInputV2, BattleLog, DefenseGraph, DefenseNode, SheetEvent } from "../../src/types.js";

describe("getPatchServerConfigV2", () => {
  it("matches docs/RULESET.md §14", () => {
    expect(getPatchServerConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, healPerTick: 8 });
    expect(getPatchServerConfigV2(2)).toEqual({ tier: 2, radiusHops: 1, healPerTick: 12 });
    expect(getPatchServerConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, healPerTick: 18 });
  });

  it("increases heal per tick with tier", () => {
    expect(getPatchServerConfigV2(1).healPerTick).toBeLessThan(getPatchServerConfigV2(2).healPerTick);
    expect(getPatchServerConfigV2(2).healPerTick).toBeLessThan(getPatchServerConfigV2(3).healPerTick);
  });

  it("throws on an unknown tier rather than silently returning undefined", () => {
    expect(() => getPatchServerConfigV2(4 as never)).toThrow(/no v2 patch-server config/);
  });
});

/** Entry 1/2 -> Firewall I 3 -> Core 4, Patch Server I 5 hanging off the Firewall at hop 1. */
function graphWithPatchServer(includePatchServer: boolean): DefenseGraph {
  const nodes: DefenseNode[] = [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "firewall", tier: 1 },
    { id: 4, type: "core" },
  ];
  const edges = [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 300 },
  ];
  if (includePatchServer) {
    nodes.push({ id: 5, type: "patch-server", tier: 1 });
    edges.push({ from: 3, to: 5, lengthDu: 200 });
  }
  return { nodes, edges, entryNodeIds: [1, 2], coreNodeId: 4, coreHp: 5000 };
}

const HOLD_AT_FIREWALL: SheetEvent[] = [{ conditions: [], actions: [{ kind: "move-toward-core" }], children: [] }];

function run(includePatchServer: boolean): BattleLog {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events: HOLD_AT_FIREWALL }, defense: graphWithPatchServer(includePatchServer) };
  return simulate(input);
}

describe("Patch Server — engine integration", () => {
  it("can starve out a pure-grind matchup: a virus that breaks the Firewall alone instead dies trying once it's healed", () => {
    // Without a server: Firewall I nets 15/tick, breaks in 34 ticks, costing the virus 34*20=680
    // Integrity (RULESET.md §9's original "survivable without an Attack block" finding) — attacker wins.
    const withoutServer = run(false);
    expect(withoutServer.result.winner).toBe("attacker");
    expect(withoutServer.events.some((event) => event.type === "node-destroyed" && event.target === "3")).toBe(true);

    // With a server: net drain drops to 7/tick, so breaking it takes ~72 ticks of counter-fire —
    // long enough that the SAME virus's own 1000 Integrity runs out first (34 ticks -> 680 damage,
    // 72 ticks -> ~1440, well past dead). Same sheet, same seed, opposite outcome.
    const withServer = run(true);
    expect(withServer.result.winner).toBe("defender");
    expect(withServer.events.some((event) => event.type === "node-destroyed" && event.target === "3")).toBe(false);
  });

  it("logs a node-repaired event on the same tick as the damage it's partially undoing", () => {
    const log = run(true);
    const firstRepair = log.events.find((event) => event.type === "node-repaired" && event.target === "3");
    expect(firstRepair).toMatchObject({ actor: "5", delta: 8 });
    expect(log.events.some((event) => event.type === "node-damaged" && event.target === "3" && event.tick === firstRepair!.tick)).toBe(true);
  });

  it("also heals the Core when it's within radius, not just Firewalls", () => {
    const nodes: DefenseNode[] = [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "core" },
      { id: 4, type: "patch-server", tier: 1 },
    ];
    const graph: DefenseGraph = {
      nodes,
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 4, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 3,
      coreHp: 5000,
    };
    const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events: HOLD_AT_FIREWALL }, defense: graph };
    const log = simulate(input);
    expect(log.events.some((event) => event.type === "node-repaired" && event.target === "3" && event.actor === "4")).toBe(true);
  });
});

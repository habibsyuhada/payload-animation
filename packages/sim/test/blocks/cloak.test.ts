import { describe, expect, it } from "vitest";
import { getCloakDurationNodes } from "../../src/blocks/cloak.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getCloakDurationNodes", () => {
  it("matches docs/RULESET.md §4.4", () => {
    expect(getCloakDurationNodes(1)).toBe(3);
    expect(getCloakDurationNodes(2)).toBe(4);
    expect(getCloakDurationNodes(3)).toBe(5);
  });
});

describe("Cloak — engine integration", () => {
  // A long single corridor entry -> router x6 -> core, with an ICE Sentry glued to every router
  // so the virus is always in range of at least one shooter — a good stress test for "never
  // targeted while cloaked, always a fair target once it expires".
  function corridorGraph(): DefenseGraph {
    const routerIds = [10, 11, 12, 13, 14, 15];
    const nodes: DefenseNode[] = [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      ...routerIds.map((id) => ({ id, type: "router" as const })),
      { id: 4, type: "core" },
      ...routerIds.map((id) => ({ id: id + 100, type: "ice-sentry" as const, tier: 1 as const })),
    ];
    const edges = [
      { from: 1, to: routerIds[0]!, lengthDu: 200 },
      { from: 2, to: routerIds[0]!, lengthDu: 200 },
      ...routerIds.slice(0, -1).map((id, i) => ({ from: id, to: routerIds[i + 1]!, lengthDu: 200 })),
      { from: routerIds[routerIds.length - 1]!, to: 4, lengthDu: 200 },
      ...routerIds.map((id) => ({ from: id, to: id + 100, lengthDu: 200 })),
    ];
    return { nodes, edges, entryNodeIds: [1, 2], coreNodeId: 4, coreHp: 100 };
  }

  it("takes no ICE damage while cloaked for its first N nodes traveled", () => {
    const cloakTier = 2; // duration 4 nodes
    const graph = corridorGraph();
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "cloak", tier: cloakTier }] }, defense: graph };
    const log = simulate(input);
    // node #1 is the entry itself; cloak covers the first getCloakDurationNodes(tier) node
    // visits, so it expires the tick the (duration+1)-th arrival happens.
    const duration = getCloakDurationNodes(cloakTier);
    const arrivals = log.events.filter((event) => event.type === "virus-entered-node");
    const cloakExpiresAtTick = arrivals[duration]?.tick ?? Infinity;
    const hitsWhileCloaked = log.events.filter((event) => event.type === "virus-damaged" && event.tick < cloakExpiresAtTick);
    expect(hitsWhileCloaked).toHaveLength(0);
  });

  it("becomes a valid ICE target again once Cloak's node budget is spent", () => {
    const graph = corridorGraph();
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "cloak", tier: 1 }] }, defense: graph };
    const log = simulate(input);
    expect(log.events.some((event) => event.type === "virus-damaged")).toBe(true);
  });

  it("without Cloak, the same corridor draws ICE fire immediately", () => {
    const graph = corridorGraph();
    const input: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph };
    const log = simulate(input);
    const firstDamageTick = log.events.find((event) => event.type === "virus-damaged")?.tick;
    const withCloak = simulate({ ...input, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "cloak", tier: 3 }] } });
    const firstDamageTickCloaked = withCloak.events.find((event) => event.type === "virus-damaged")?.tick;
    expect(firstDamageTickCloaked ?? Infinity).toBeGreaterThan(firstDamageTick ?? -Infinity);
  });
});

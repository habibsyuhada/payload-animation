import { describe, expect, it } from "vitest";
import { simulate } from "../../src/engine.js";
import { trapTriggerDamage } from "../../src/nodes/trap.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("trapTriggerDamage", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(trapTriggerDamage(1)).toBe(180);
    expect(trapTriggerDamage(2)).toBe(260);
    expect(trapTriggerDamage(3)).toBe(350);
  });
});

describe("Trap — engine integration", () => {
  // entry(1)/(2) --200du--> trap I(3) --200du--> core(4).
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "trap", tier: 1 },
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

  it("deals its one-shot damage on the same tick as first entry (no next-tick delay, unlike Honeypot)", () => {
    const log = simulate(input);
    // arrives tick 4 -> damage applied tick 4, immediately.
    expect(log.events).toContainEqual({ tick: 4, type: "virus-damaged", actor: "3", target: "virus", delta: -180 });
  });

  it("does not block movement — the virus departs on the very next tick, same as any pass-through node", () => {
    const log = simulate(input);
    // core is 200du away at speed 50 -> 4 more ticks: departs tick 5, arrives tick 9, then core
    // (coreHp 100) drains 10 ticks -> wins tick 18.
    expect(log.result.winner).toBe("attacker");
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 9, type: "virus-entered-node", target: "4" }));
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 18, type: "battle-won" });
  });

  it("only ever fires once — a random-walk virus that revisits an already-spent trap takes no further damage", () => {
    // Triangle: entry(1)-trap(3), trap(3)-A(5), A(5)-entry(1), A(5)-core(4) — random-walk can
    // loop entry->trap->A->entry->trap->... before eventually taking the trap->A->core exit.
    const loopGraph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "trap", tier: 1 },
        { id: 5, type: "router" },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 200 },
        { from: 2, to: 3, lengthDu: 200 },
        { from: 3, to: 5, lengthDu: 200 },
        { from: 5, to: 1, lengthDu: 200 },
        { from: 5, to: 4, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };

    let found: ReturnType<typeof simulate> | null = null;
    for (let seed = 1; seed <= 200 && !found; seed += 1) {
      const log = simulate({ rulesetVersion: "v1", seed, virus: { movement: { kind: "random-walk" }, blocks: [] }, defense: loopGraph });
      const trapVisits = log.events.filter((event) => event.type === "virus-entered-node" && event.target === "3").length;
      if (trapVisits >= 2) {
        found = log;
      }
    }

    expect(found, "expected at least one seed in [1,200] to revisit the trap node twice").not.toBeNull();
    const trapDamageEvents = found!.events.filter((event) => event.type === "virus-damaged" && event.actor === "3");
    expect(trapDamageEvents).toHaveLength(1);
  });
});

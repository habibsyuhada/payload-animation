import { describe, expect, it } from "vitest";
import { simulate } from "../../src/engine.js";
import type { DefenseGraph, DefenseNode } from "../../src/types.js";

/**
 * Router has no logic module to unit-test directly (src/nodes/router.ts is deliberately empty —
 * see its docstring) — its behavior IS the engine's default for anything it doesn't special-case.
 * These tests prove that default via the engine.
 */
describe("Router — engine integration", () => {
  it("never blocks movement — departs on the standard next-tick schedule like any pass-through node", () => {
    // entry(1)/(2) --200du--> router(3) --200du--> core(4), speed 50: arrive router tick 4,
    // depart tick 5, arrive core tick 9, then ceil(100/15)=7 drain ticks (9..15) -> win tick 15.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
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
    const log = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph });
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 4, type: "virus-entered-node", target: "3" }));
    expect(log.events).toContainEqual(expect.objectContaining({ tick: 9, type: "virus-entered-node", target: "4" }));
    expect(log.events[log.events.length - 1]).toMatchObject({ tick: 15, type: "battle-won" });
  });

  it("emits no node-specific event of its own — router visits produce only the generic virus-entered-node marker", () => {
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
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
    const log = simulate({ rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: graph });
    const routerEvents = log.events.filter((event) => event.actor === "3" || event.target === "3");
    expect(routerEvents).toEqual([expect.objectContaining({ type: "virus-entered-node", target: "3" })]);
  });

  it("a revisited Entry node is equally inert — no special effect fires even if random-walk loops back through it", () => {
    // entry(1) - A(3) - entry(1) cycle, entry(2) - A(3), A(3) - core(4): random-walk from A can
    // wander back to entry(1) before eventually reaching core.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
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

    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed += 1) {
      const log = simulate({ rulesetVersion: "v1", seed, virus: { movement: { kind: "random-walk" }, blocks: [] }, defense: graph });
      const entryRevisits = log.events.filter((event) => event.type === "virus-entered-node" && (event.target === "1" || event.target === "2")).length;
      if (entryRevisits >= 2) {
        found = true;
        const entryEvents = log.events.filter((event) => event.actor === "1" || event.actor === "2");
        expect(entryEvents).toHaveLength(0); // entries are never an `actor` — they never trigger anything
      }
    }
    expect(found, "expected at least one seed in [1,200] to revisit an entry node").toBe(true);
  });
});

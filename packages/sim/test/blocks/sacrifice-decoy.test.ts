import { describe, expect, it } from "vitest";
import { getSacrificeDecoyConfig, nextSacrificeDecoyThreshold, shouldArmSacrificeDecoy } from "../../src/blocks/sacrifice-decoy.js";
import { simulate } from "../../src/engine.js";
import type { BattleInput, DefenseGraph, DefenseNode } from "../../src/types.js";

describe("getSacrificeDecoyConfig", () => {
  it("matches docs/RULESET.md §4.5", () => {
    expect(getSacrificeDecoyConfig(1)).toEqual({ tier: 1, chargesTotal: 1, absorbsPerActivation: 1 });
    expect(getSacrificeDecoyConfig(3)).toEqual({ tier: 3, chargesTotal: 3, absorbsPerActivation: 2 });
  });
});

describe("shouldArmSacrificeDecoy / nextSacrificeDecoyThreshold", () => {
  it("arms once Integrity drops to/below the threshold and a charge remains", () => {
    expect(shouldArmSacrificeDecoy(200, 200, 1)).toBe(true);
    expect(shouldArmSacrificeDecoy(201, 200, 1)).toBe(false);
    expect(shouldArmSacrificeDecoy(200, 200, 0)).toBe(false);
  });

  it("re-arms 20% below the previous trigger point", () => {
    expect(nextSacrificeDecoyThreshold(200)).toBe(0);
  });
});

describe("Sacrifice Decoy — engine integration", () => {
  // entry(1)/(2) --200du--> honeypot I(3) --200du--> core(4). A plain honeypot would otherwise
  // be an instant kill; Integrity is still full (1000‰ > 200‰) at that point, so the decoy
  // hasn't even armed yet on THIS specific trigger — this graph exists to prove the trigger
  // itself gets consumed as an absorb once armed, tested via the ICE scenario below instead.
  function honeypotGraph(): DefenseGraph {
    return {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "honeypot", tier: 1 },
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
  }

  it("does nothing before Integrity ever crosses the 200‰ arm threshold — Honeypot is still lethal", () => {
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "sacrifice-decoy", tier: 1 }] },
      defense: honeypotGraph(),
    };
    const log = simulate(input);
    expect(log.result.winner).toBe("defender");
    expect(log.events.some((event) => event.type === "decoy-absorbed")).toBe(false);
  });

  it("absorbs a lethal Honeypot trigger once armed by prior (deterministic Trap) damage, and the virus survives", () => {
    // A straight chain of Traps brings Integrity down in known, fixed steps (no RNG/accuracy
    // involved, unlike ICE) so the exact moment it crosses the 200‰ arm threshold is exact:
    // 1000 -350(trap III) -350(trap III) -260(trap II) = 40‰, arming right on that 3rd trap's
    // own tick (that trigger itself isn't absorbed — decoy wasn't armed yet before it landed).
    // The Honeypot right after is then the first trigger evaluated *after* arming.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 10, type: "trap", tier: 3 },
        { id: 11, type: "trap", tier: 3 },
        { id: 12, type: "trap", tier: 2 },
        { id: 13, type: "honeypot", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 10, lengthDu: 200 },
        { from: 2, to: 10, lengthDu: 200 },
        { from: 10, to: 11, lengthDu: 200 },
        { from: 11, to: 12, lengthDu: 200 },
        { from: 12, to: 13, lengthDu: 200 },
        { from: 13, to: 4, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
    const input: BattleInput = {
      rulesetVersion: "v1",
      seed: 1,
      virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "sacrifice-decoy", tier: 1 }] },
      defense: graph,
    };
    const log = simulate(input);
    const armEvent = log.events.find((event) => event.type === "status-applied" && event.actor === "sacrifice-decoy");
    expect(armEvent).toBeDefined();
    expect(log.events).toContainEqual(expect.objectContaining({ type: "decoy-absorbed", actor: "13" }));
    expect(log.result.winner).toBe("attacker");
  });

  it("only has as many charges as its tier grants — tier I can't absorb a second lethal trigger", () => {
    // Two honeypots in a row; Integrity must be re-armed (dropped another 20%) between them for
    // a second absorb to even be attempted — with only 1 charge (tier I), the second is lethal.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 5, type: "ice-sentry", tier: 3 },
        { id: 3, type: "router" },
        { id: 6, type: "honeypot", tier: 1 },
        { id: 7, type: "honeypot", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
      edges: [
        { from: 1, to: 3, lengthDu: 2000 },
        { from: 2, to: 3, lengthDu: 2000 },
        { from: 3, to: 5, lengthDu: 200 },
        { from: 3, to: 6, lengthDu: 200 },
        { from: 6, to: 7, lengthDu: 200 },
        { from: 7, to: 4, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100,
    };
    let found: ReturnType<typeof simulate> | null = null;
    for (let seed = 1; seed <= 100 && !found; seed += 1) {
      const log = simulate({ rulesetVersion: "v1", seed, virus: { movement: { kind: "shortest-path" }, blocks: [{ kind: "sacrifice-decoy", tier: 1 }] }, defense: graph });
      const absorbed = log.events.filter((event) => event.type === "decoy-absorbed").length;
      if (absorbed === 1 && log.result.winner === "defender") {
        found = log;
      }
    }
    expect(found, "expected at least one seed in [1,100] where the 1st honeypot is absorbed and the 2nd is lethal").not.toBeNull();
  });
});

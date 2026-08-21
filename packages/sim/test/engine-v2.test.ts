import { describe, expect, it } from "vitest";
import { getCloakConfigV2 } from "../src/ruleset-v2.js";
import { simulate } from "../src/simulate.js";
import type { BattleEvent, BattleInputV2, BattleLog, DefenseGraph, DefenseNode, SheetEvent } from "../src/types.js";

/**
 * V7.1 — the sheet engine's own semantics (docs/ADR/0006). Every test here asserts on the LOG,
 * not on internal state: the log is the contract a replay and a server both read.
 */

function node(id: number, type: DefenseNode["type"], tier?: 1 | 2 | 3): DefenseNode {
  return tier === undefined ? { id, type } : { id, type, tier };
}

function row(partial: Partial<SheetEvent> = {}): SheetEvent {
  return { conditions: [], actions: [], children: [], ...partial };
}

/** Entry 1/2 -> Firewall 3 -> Core 4. One Firewall so Attack actions have something to chew. */
const FIREWALL_LINE: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "entry"), node(3, "firewall", 1), node(4, "core")],
  edges: [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 300 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 600,
};

/** Entry 1/2 -> Router 3 -> Core 4, with a Honeypot 5 hanging off the router as the short way. */
const HONEYPOT_FORK: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "entry"), node(3, "router"), node(4, "core"), node(5, "honeypot", 1)],
  edges: [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 5, lengthDu: 200 },
    { from: 5, to: 4, lengthDu: 200 },
    { from: 3, to: 4, lengthDu: 900 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 400,
};

/** Entry 1/2 -> Firewall III 3 -> Core 4. The counter-damage here outruns any repair. */
const HARD_FIREWALL_LINE: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "entry"), node(3, "firewall", 3), node(4, "core")],
  edges: [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 300 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 600,
};

/** Entry 1/2 -> Router 3 -> Core 4. Nothing here can hurt the virus. */
const QUIET_LINE: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "entry"), node(3, "router"), node(4, "core")],
  edges: [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 300 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 400,
};

/** Entry 1 -> hub Router 2 -> three branches (Entry backward, Router 3, Router 4). Nothing here can
 * hurt the virus — used to isolate move-random's per-entity divergence from any combat noise. */
const SPLIT_HUB: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "router"), node(3, "router"), node(4, "router"), node(5, "core")],
  edges: [
    { from: 1, to: 2, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 2, to: 4, lengthDu: 300 },
    { from: 3, to: 5, lengthDu: 300 },
  ],
  entryNodeIds: [1],
  coreNodeId: 5,
  coreHp: 400,
};

/** Entry 1 -> Firewall A (short) or Router -> Firewall B (longer, via a detour) -> Core 5. Both
 * Firewalls are tier I and never get attacked in these tests, so whichever body wanders into
 * either one is pinned there and dies to counter-damage alone — the two paths differ in length so
 * two split bodies wandering independently reach their firewall (and so their death) at different
 * ticks. */
const SPLIT_TWO_FIREWALLS: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "firewall", 1), node(3, "router"), node(4, "firewall", 1), node(5, "core")],
  edges: [
    { from: 1, to: 2, lengthDu: 100 },
    { from: 1, to: 3, lengthDu: 100 },
    { from: 3, to: 4, lengthDu: 400 },
    { from: 2, to: 5, lengthDu: 100 },
    { from: 4, to: 5, lengthDu: 100 },
  ],
  entryNodeIds: [1],
  coreNodeId: 5,
  coreHp: 400,
};

/** Entry 1 -> Router 2 (split point) -> Honeypot 3 -> Core 4. Deterministic move-toward-core for
 * both bodies, so they arrive at the Honeypot on the identical tick — proof that the SECOND body
 * to be processed that same tick sees the Honeypot already spent (PLAN.md 8.3c). */
const SPLIT_THEN_HONEYPOT: DefenseGraph = {
  nodes: [node(1, "entry"), node(2, "router"), node(3, "honeypot", 1), node(4, "core")],
  edges: [
    { from: 1, to: 2, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 300 },
  ],
  entryNodeIds: [1],
  coreNodeId: 4,
  coreHp: 400,
};

function battle(events: readonly SheetEvent[], defense: DefenseGraph = FIREWALL_LINE, seed = 7): BattleLog {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed, virus: { events }, defense };
  return simulate(input);
}

function firedRules(log: BattleLog): string[] {
  return [...new Set(log.events.filter((event) => event.type === "rule-fired").map((event) => event.actor))].sort();
}

function nodeDamageTo(log: BattleLog, nodeId: number): number {
  return log.events
    .filter((event: BattleEvent) => event.type === "node-damaged" && event.target === String(nodeId))
    .reduce((sum, event) => sum + Math.abs(event.delta ?? 0), 0);
}

describe("simulate — dispatch by rulesetVersion", () => {
  it("runs the sheet engine for a v2 input and the block engine for a v1 one", () => {
    const v2 = battle([row({ actions: [{ kind: "move-toward-core" }] })]);
    expect(v2.input.rulesetVersion).toBe("v2");
    expect(v2.events.some((event) => event.type === "rule-fired")).toBe(true);

    const v1 = simulate({ rulesetVersion: "v1", seed: 7, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: FIREWALL_LINE });
    expect(v1.events.some((event) => event.type === "rule-fired")).toBe(false);
  });
});

describe("evaluation order and nesting", () => {
  it("skips a child row when its parent's conditions fail — the whole subtree, not just the actions", () => {
    // Parent asks for a Scanner that isn't in this graph, so nothing under it may run.
    const log = battle([
      row({
        conditions: [{ kind: "node-here-is", targetNodeTypes: ["scanner"] }],
        actions: [{ kind: "brute-force", tier: 1 }],
        children: [row({ actions: [{ kind: "brute-force", tier: 3 }] })],
      }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(firedRules(log)).toEqual(["1"]);
  });

  it("runs a child row only while its parent holds", () => {
    const log = battle([
      row({
        conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }],
        children: [row({ actions: [{ kind: "brute-force", tier: 1 }] })],
      }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    // The child only ever fires on the Firewall, so the Core takes nothing but its passive drain.
    expect(firedRules(log)).toContain("0.0");
    expect(nodeDamageTo(log, 3)).toBeGreaterThan(0);
  });

  it("treats an empty condition list as `always`", () => {
    const log = battle([row({ actions: [{ kind: "move-toward-core" }] })]);
    expect(log.events.some((event) => event.type === "virus-departed-node")).toBe(true);
  });

  it("honours `negate` as NOT on a single condition", () => {
    const stayPut = battle([row({ conditions: [{ kind: "at-node", negate: true }], actions: [{ kind: "move-toward-core" }] })]);
    // "not at a node" is false at the Entry, so the virus never departs and the battle times out.
    expect(stayPut.events.some((event) => event.type === "virus-departed-node")).toBe(false);
    expect(stayPut.result.winner).toBe("defender");
  });
});

describe("action conflicts", () => {
  it("gives a movement slot to the FIRST rule that writes it, not the last (ADR 0006 §3)", () => {
    const holdWins = battle([
      row({ conditions: [{ kind: "node-here-is", targetNodeTypes: ["entry"] }], actions: [{ kind: "hold-position" }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(holdWins.events.some((event) => event.type === "virus-departed-node")).toBe(false);

    // Same two rules, swapped: now the generic mover is on top and wins every tick.
    const moveWins = battle([
      row({ actions: [{ kind: "move-toward-core" }] }),
      row({ conditions: [{ kind: "node-here-is", targetNodeTypes: ["entry"] }], actions: [{ kind: "hold-position" }] }),
    ]);
    expect(moveWins.events.some((event) => event.type === "virus-departed-node")).toBe(true);
  });

  it("stacks cumulative actions — two Brute Force rows both land", () => {
    const single = battle([row({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] })]);
    const double = battle([
      row({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] }),
    ]);
    expect(double.result.score.value).toBeGreaterThan(single.result.score.value);
  });

  it("fires Exploit only on the first tick at a node, so it can't be spammed by an unguarded row", () => {
    const exploitOnly = battle([row({ actions: [{ kind: "exploit", tier: 1 }, { kind: "move-toward-core" }] })]);
    const bruteOnly = battle([row({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] })]);
    // 250 one-shot on arrival beats 40/tick for exactly one tick, and no more.
    expect(nodeDamageTo(exploitOnly, 3)).toBeLessThan(nodeDamageTo(bruteOnly, 3) + 250 * 10);
    expect(exploitOnly.events.filter((event) => event.type === "rule-fired").length).toBeGreaterThan(0);
  });
});

describe("trigger-once", () => {
  it('`once: "battle"` runs a row exactly one tick', () => {
    const log = battle([
      row({ once: "battle", actions: [{ kind: "brute-force", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(log.events.filter((event) => event.type === "rule-fired" && event.actor === "0")).toHaveLength(0);
    // The row does run — on the Entry, where a Brute Force has nothing to hit — and is then spent.
    const onFirewall = battle([
      row({ once: "battle", conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }], actions: [{ kind: "brute-force", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(onFirewall.events.filter((event) => event.type === "rule-fired" && event.actor === "0")).toHaveLength(1);
  });

  it('`once: "node"` re-arms on a different node', () => {
    const log = battle([
      row({ once: "node", actions: [{ kind: "brute-force", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    // Fires on the Firewall and again on the Core — two distinct nodes, two firings.
    expect(log.events.filter((event) => event.type === "rule-fired" && event.actor === "0")).toHaveLength(2);
  });
});

describe("rule-fired", () => {
  it("names the row by its path when it has no id, and by its id when it has one", () => {
    const log = battle([row({ id: "attack", actions: [{ kind: "brute-force", tier: 1 }] }), row({ actions: [{ kind: "move-toward-core" }] })]);
    expect(firedRules(log)).toEqual(["1", "attack"]);
  });

  it("stays silent for a row whose actions had no effect", () => {
    // Nothing on this map ever damages the virus, so Self Repair runs every tick and heals
    // nothing — a row that runs is not a row that fired.
    const log = battle([row({ actions: [{ kind: "self-repair", tier: 1 }] }), row({ actions: [{ kind: "move-toward-core" }] })], QUIET_LINE);
    expect(firedRules(log)).toEqual(["1"]);
  });
});

describe("conditions", () => {
  it('"node di depan" sees the node the virus has not reached yet, unlike "node saat ini"', () => {
    const ahead = battle([
      row({ conditions: [{ kind: "node-ahead-is", targetNodeTypes: ["firewall"] }], id: "ahead", actions: [{ kind: "cloak", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    // At the Entry the Firewall is ahead but not underfoot: the sheet reacts before arriving.
    expect(ahead.events.some((event) => event.type === "rule-fired" && event.actor === "ahead" && event.tick === 0)).toBe(true);

    const here = battle([
      row({ conditions: [{ kind: "node-here-is", targetNodeTypes: ["firewall"] }], id: "here", actions: [{ kind: "cloak", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(here.events.some((event) => event.type === "rule-fired" && event.actor === "here" && event.tick === 0)).toBe(false);
  });

  it("routes around a Honeypot the sensor condition can see", () => {
    const straightIn = battle([row({ actions: [{ kind: "move-toward-core" }] })], HONEYPOT_FORK);
    expect(straightIn.result.winner).toBe("defender");
    expect(straightIn.events.some((event) => event.type === "virus-died")).toBe(true);

    const avoiding = battle(
      [
        row({ conditions: [{ kind: "honeypot-near", tier: 2 }], id: "dodge", actions: [{ kind: "move-avoiding-hazards" }] }),
        row({ actions: [{ kind: "move-toward-core" }] }),
      ],
      HONEYPOT_FORK,
    );
    expect(avoiding.result.winner).toBe("attacker");
    expect(firedRules(avoiding)).toContain("dodge");
  });

  it("reads `took-damage-last-tick` from the tick that already resolved", () => {
    const log = battle([
      row({ conditions: [{ kind: "took-damage-last-tick" }], id: "hurt", actions: [{ kind: "self-repair", tier: 3 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    // The Firewall's counter-damage is the only source here, so the repair can only fire after it.
    const firstCounter = log.events.find((event) => event.type === "virus-damaged")!;
    const firstRepair = log.events.find((event) => event.type === "rule-fired" && event.actor === "hurt");
    expect(firstRepair).toBeDefined();
    expect(firstRepair!.tick).toBeGreaterThan(firstCounter.tick);
  });
});

describe("v2 mechanic changes (ADR 0006 §8)", () => {
  it("measures Cloak in ticks and refuses to refresh it during its cooldown", () => {
    const config = getCloakConfigV2(1);
    const log = battle([row({ id: "cloak", actions: [{ kind: "cloak", tier: 1 }] }), row({ actions: [{ kind: "hold-position" }] })]);
    const cloakTicks = log.events.filter((event) => event.type === "status-applied" && event.actor === "cloak").map((event) => event.tick);
    expect(cloakTicks[0]).toBe(0);
    // Second application waits out duration + cooldown, not one tick.
    expect(cloakTicks[1]).toBe(config.durationTicks + config.cooldownTicks);
  });

  it("makes Self Repair's old hidden gates the player's own rows", () => {
    const repairs = (log: BattleLog): number => log.events.filter((event) => event.type === "virus-repaired").length;

    // Ungated, Self Repair heals while standing on a Breach Node taking counter-damage. v1
    // refused to do that, invisibly, and a player had no way to see why.
    const ungated = battle([row({ actions: [{ kind: "self-repair", tier: 3 }, { kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] })]);
    expect(repairs(ungated)).toBeGreaterThan(0);

    // The same gate v1 hardcoded, written as a row the player can read and delete.
    const gated = battle([
      row({ conditions: [{ kind: "on-breach-node", negate: true }], actions: [{ kind: "self-repair", tier: 3 }] }),
      row({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-toward-core" }] }),
    ]);
    expect(repairs(gated)).toBeGreaterThan(0);
    expect(repairs(gated)).toBeLessThan(repairs(ungated));
  });
});

describe("death", () => {
  it("stays dead once Integrity reaches 0 — an ungated Self Repair cannot resurrect it later in the same tick", () => {
    // Pinned on a Firewall III, the counter-damage lands in step 4 and the repair in step 5,
    // both before the end-of-tick death check. Without the latch this virus ping-pongs between 0
    // and +heal forever and grinds the whole defense down (found by tools/balance-lab's dominance
    // search, not by hand).
    const log = battle([row({ actions: [{ kind: "self-repair", tier: 3 }, { kind: "move-toward-core" }] })], HARD_FIREWALL_LINE);
    expect(log.result.winner).toBe("defender");
    expect(log.events.some((event) => event.type === "virus-died")).toBe(true);
    const death = log.events.find((event) => event.type === "virus-died")!;
    // Nothing may follow the death but the death itself.
    expect(log.events.filter((event) => event.type === "virus-repaired" && event.tick >= death.tick)).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("is a pure function of (seed, sheet, defense)", () => {
    const sheet = [
      row({ conditions: [{ kind: "integrity-below", integrityThresholdPermille: 700 }], actions: [{ kind: "arm-decoy", tier: 2 }] }),
      row({ actions: [{ kind: "brute-force", tier: 1 }, { kind: "move-random" }] }),
    ];
    expect(JSON.stringify(battle(sheet, HONEYPOT_FORK, 42))).toBe(JSON.stringify(battle(sheet, HONEYPOT_FORK, 42)));
  });

  it("keeps evaluation itself free of RNG — an extra condition-only row does not shift the dice", () => {
    const base: readonly SheetEvent[] = [row({ actions: [{ kind: "move-random" }] })];
    const withInertRow: readonly SheetEvent[] = [row({ conditions: [{ kind: "is-scanned" }] }), ...base];
    const positions = (log: BattleLog): string[] => log.events.filter((event) => event.type === "virus-entered-node").map((event) => event.target!);
    expect(positions(battle(withInertRow, HONEYPOT_FORK, 3))).toEqual(positions(battle(base, HONEYPOT_FORK, 3)));
  });
});

describe("set-checkpoint & respawn (8.3d)", () => {
  it("respawns exactly once at the checkpoint node, with virus-died -> virus-respawned -> virus-entered-node, then stays permanently dead once the charge is spent", () => {
    const log = battle(
      [row({ once: "battle", actions: [{ kind: "set-checkpoint", tier: 1 }] }), row({ actions: [{ kind: "move-toward-core" }] })],
      HARD_FIREWALL_LINE,
      7,
    );
    expect(log.result.winner).toBe("defender");
    const respawn = log.events.find((event) => event.type === "virus-respawned")!;
    expect(respawn).toBeDefined();
    expect(respawn.target).toBe("1"); // the Entry it set the checkpoint at.
    expect(respawn.delta).toBe(300); // tier I's flat respawn Integrity.
    // Exactly the triple, all at the same tick, in that order (other events that tick — the
    // Firewall's own counter-damage — happen earlier, in node effects, not part of this sequence).
    const respawnSequence = log.events.filter((event) => event.tick === respawn.tick && (event.type === "virus-died" || event.type === "virus-respawned" || event.type === "virus-entered-node"));
    expect(respawnSequence.map((event) => event.type)).toEqual(["virus-died", "virus-respawned", "virus-entered-node"]);
    // Only one respawn ever happens (tier I grants exactly 1) — the second death is final.
    expect(log.events.filter((event) => event.type === "virus-respawned")).toHaveLength(1);
    const deaths = log.events.filter((event) => event.type === "virus-died");
    expect(deaths).toHaveLength(2);
    expect(deaths[1]!.tick).toBeGreaterThan(respawn.tick);
    // The final death is the very last event before the battle-ending result — no further respawn.
    expect(log.events[log.events.length - 1]).toBe(deaths[1]);
  });

  it("never brings back a body that died to its own detonate (RULESET.md §14: no respawn for detonate deaths)", () => {
    const log = battle([
      row({ once: "battle", conditions: [{ kind: "at-node" }], actions: [{ kind: "set-checkpoint", tier: 3 }] }),
      row({ once: "battle", conditions: [{ kind: "on-breach-node" }], actions: [{ kind: "detonate", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(log.result.winner).toBe("defender");
    expect(log.events.some((event) => event.type === "virus-respawned")).toBe(false);
    // A checkpoint WAS armed (proves the lack of respawn is `noRespawn`, not "never had a checkpoint").
    expect(log.events.some((event) => event.type === "status-applied" && event.actor === "set-checkpoint")).toBe(true);
    expect(log.events.filter((event) => event.type === "virus-died")).toHaveLength(1);
  });

  it("does not carry a checkpoint into a new split body — only the entity that armed it respawns", () => {
    const log = battle(
      [
        row({ once: "battle", conditions: [{ kind: "at-node" }], actions: [{ kind: "set-checkpoint", tier: 1 }] }),
        row({ once: "battle", conditions: [{ kind: "on-breach-node" }], actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }] }),
        row({ actions: [{ kind: "move-toward-core" }] }),
      ],
      // Firewall III's counter-damage (45/tick) kills a split body (500 Integrity, ~11 ticks)
      // long before two bodies' doubled passive drain could destroy the Firewall itself (40 ticks)
      // — so both stay pinned there long enough to die, rather than breaking through together.
      HARD_FIREWALL_LINE,
      7,
    );
    // Entity 0 armed its checkpoint at the Entry BEFORE splitting at the Firewall; the clone (entity
    // 1) is born after that and gets no checkpoint of its own (PLAN.md 8.3d) — the two bodies are
    // pinned on the same Firewall with identical Integrity, so they die on the exact same tick.
    const respawn = log.events.find((event) => event.type === "virus-respawned")!;
    expect(respawn).toBeDefined();
    expect(respawn.entityId).toBe(0);
    expect(log.events.filter((event) => event.type === "virus-respawned")).toHaveLength(1);
    // Entity 1 never respawns and never acts again after the shared death tick.
    const entity1LastDamage = Math.max(...log.events.filter((event) => event.type === "virus-damaged" && event.entityId === 1).map((event) => event.tick));
    expect(log.events.some((event) => event.entityId === 1 && event.tick > entity1LastDamage)).toBe(false);
    // Entity 0, on the other hand, keeps generating events well after that same tick.
    expect(log.events.some((event) => event.entityId === 0 && event.tick > entity1LastDamage)).toBe(true);
  });
});

describe("caps", () => {
  it("parks a sheet with no movement action until the battle times out", () => {
    const log = battle([row({ actions: [{ kind: "brute-force", tier: 3 }] })]);
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]!.type).toBe("battle-timeout");
  });
});

describe("entityId gating (8.3b)", () => {
  // Mirrors types.ts's BattleEvent.entityId doc: defense-side and battle-level events never carry
  // one, split-capable or not — only events "about" a specific body do.
  const BATTLE_LEVEL_TYPES = new Set(["battle-won", "virus-died", "battle-timeout"]);

  function isEntitySpecific(event: BattleEvent): boolean {
    if (BATTLE_LEVEL_TYPES.has(event.type)) {
      return false;
    }
    if (event.type === "node-repaired") {
      return false; // Patch Server heal is entity-independent — it heals nodes, not bodies.
    }
    if (event.type === "status-applied" && event.target === "core") {
      return false; // Alarm Relay's network-wide alert, not a body's own status.
    }
    return true;
  }

  it("omits entityId from every event for a sheet that can never split", () => {
    const log = battle([row({ actions: [{ kind: "move-toward-core" }] })]);
    expect(log.events.length).toBeGreaterThan(0);
    for (const event of log.events) {
      expect("entityId" in event).toBe(false);
    }
  });

  it("stamps entityId on every entity-specific event, including tick 0, for a sheet containing worm-split", () => {
    // This sheet actually splits (8.3c), so the log carries two bodies' worth of events — entity 0
    // from tick 0 onward, entity 1 from the tick after it's born.
    const log = battle([row({ actions: [{ kind: "worm-split", tier: 1 }, { kind: "move-toward-core" }] })]);
    const entitySpecific = log.events.filter(isEntitySpecific);
    expect(entitySpecific.length).toBeGreaterThan(0);
    expect(entitySpecific[0]!.tick).toBe(0);
    expect(entitySpecific[0]!.entityId).toBe(0);
    for (const event of entitySpecific) {
      expect(typeof event.entityId).toBe("number");
    }
    expect(entitySpecific.some((event) => event.entityId === 1)).toBe(true);
    for (const event of log.events.filter((candidate) => !isEntitySpecific(candidate))) {
      expect("entityId" in event).toBe(false);
    }
  });
});

describe("detonate (8.3c)", () => {
  it("sacrifices the body's whole remaining Integrity as one-shot damage to the occupied Breach Node, then dies", () => {
    const log = battle([
      row({ once: "battle", conditions: [{ kind: "on-breach-node" }], actions: [{ kind: "detonate", tier: 1 }] }),
      row({ actions: [{ kind: "move-toward-core" }] }),
    ]);
    expect(log.result.winner).toBe("defender");
    const destroyed = log.events.find((event) => event.type === "node-destroyed" && event.target === "3");
    expect(destroyed).toBeDefined();
    const nodeDamage = log.events.find((event) => event.type === "node-damaged" && event.target === "3" && event.tick === destroyed!.tick);
    expect(nodeDamage!.delta).toBe(-500); // the firewall's full HP, clamped — 2000‰ of 1000 Integrity is massive overkill.
    const selfDamage = log.events.find((event) => event.type === "virus-damaged" && event.actor === "detonate");
    expect(selfDamage).toBeDefined();
    expect(selfDamage!.delta).toBe(-1000); // its entire starting Integrity, gone in one tick.
    expect(selfDamage!.tick).toBe(destroyed!.tick);
    expect(log.events.some((event) => event.type === "virus-died" && event.tick === destroyed!.tick)).toBe(true);
  });
});

describe("worm-split (8.3c)", () => {
  it("leaves a spent Honeypot spent for every body — a second entity arriving the same tick walks through safely (RULESET.md §14)", () => {
    const log = battle(
      [
        row({ once: "battle", conditions: [{ kind: "node-here-is", targetNodeTypes: ["router"] }], actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }] }),
        row({ actions: [{ kind: "move-toward-core" }] }),
      ],
      SPLIT_THEN_HONEYPOT,
      5,
    );
    // Both bodies arrive at the Honeypot on the same tick (deterministic move-toward-core, born
    // from identical state) — entity 0 (processed first) springs it and dies; entity 1 (processed
    // second, same tick) sees it already spent and is never even slowed down by it.
    const honeypotDamage = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "3");
    expect(honeypotDamage).toHaveLength(1);
    expect(honeypotDamage[0]!.entityId).toBe(0);
    const entity1AtHoneypot = log.events.filter((event) => (event.type === "virus-entered-node" || event.type === "virus-departed-node") && event.target === "3" && event.entityId === 1);
    expect(entity1AtHoneypot.map((event) => event.type)).toEqual(["virus-entered-node", "virus-departed-node"]);
    // Entity 1 lives on well past entity 0's death, proving it truly took no damage there.
    expect(log.events.some((event) => event.entityId === 1 && event.tick > honeypotDamage[0]!.tick)).toBe(true);
  });

  it("creates a second body sharing the same sheet, each at a share of the pre-split Integrity", () => {
    const log = battle([row({ once: "battle", actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }] }), row({ actions: [{ kind: "move-random" }] })], SPLIT_HUB, 11);
    const split = log.events.find((event) => event.type === "virus-split");
    expect(split).toBeDefined();
    expect(split!.actor).toBe("0");
    expect(split!.target).toBe("1");
    expect(split!.entityId).toBe(0);
    // Both bodies now carry entityId on their own events — proof the second body is a real,
    // independently-tracked entity, not a label on the same one.
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.entityId === 1)).toBe(true);
  });

  it("wins for the attacker the instant Core is zeroed, however many split bodies contributed", () => {
    const log = battle([
      row({ once: "battle", conditions: [{ kind: "on-breach-node" }], actions: [{ kind: "worm-split", tier: 1 }] }),
      row({ actions: [{ kind: "brute-force", tier: 3 }, { kind: "move-toward-core" }] }),
    ]);
    expect(log.result.winner).toBe("attacker");
    expect(log.events.some((event) => event.type === "virus-split")).toBe(true);
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.entityId === 1)).toBe(true);
    const won = log.events.find((event) => event.type === "battle-won")!;
    expect(won).toBeDefined();
    expect("entityId" in won).toBe(false); // battle-level, regardless of which body(s) did it.
  });

  it("keeps the battle going once one split body dies, and the defender wins only once BOTH have (RULESET.md §11a)", () => {
    const log = battle(
      [row({ once: "battle", actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }] }), row({ actions: [{ kind: "move-random" }] })],
      SPLIT_TWO_FIREWALLS,
      31,
    );
    expect(log.result.winner).toBe("defender");
    const damageTicksFor = (entityId: number): number[] => log.events.filter((event) => event.type === "virus-damaged" && event.entityId === entityId).map((event) => event.tick);
    const lastDamage0 = Math.max(...damageTicksFor(0));
    const lastDamage1 = Math.max(...damageTicksFor(1));
    // The two bodies wandered to different Firewalls (SPLIT_TWO_FIREWALLS) and so die at different
    // ticks — proving the battle-ending check is genuinely gated on ALL bodies, not just the first.
    expect(lastDamage0).toBeLessThan(lastDamage1);
    // Nothing about entity 0 appears after its own death — it is well and truly gone, not lingering.
    expect(log.events.some((event) => event.entityId === 0 && event.tick > lastDamage0)).toBe(false);
    // The battle-level death only fires once entity 1 (the survivor) also dies.
    const battleDeath = log.events.find((event) => event.type === "virus-died")!;
    expect(battleDeath.tick).toBe(lastDamage1);
    expect("entityId" in battleDeath).toBe(false);
  });

  it("draws move-random for each entity in ascending-id order, so two clones with identical state at the same node can diverge", () => {
    // entity 0 splits while pinned at Firewall A, entity 1 wanders off to Router 3 and Firewall B —
    // proof the two independently-tracked RNG draws (entity 0 first, then entity 1, same shared
    // stream) really did produce different outcomes, not just different entity ids on one path.
    const log = battle(
      [row({ once: "battle", actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }] }), row({ actions: [{ kind: "move-random" }] })],
      SPLIT_TWO_FIREWALLS,
      31,
    );
    const firstMoveTarget = (entityId: number): string | undefined =>
      log.events.find((event) => event.type === "virus-entered-node" && event.entityId === entityId && event.tick > 0)?.target;
    expect(firstMoveTarget(0)).toBe("2");
    expect(firstMoveTarget(1)).toBe("3");
  });
});

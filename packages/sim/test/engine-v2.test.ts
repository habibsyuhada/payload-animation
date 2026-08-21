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

describe("caps", () => {
  it("parks a sheet with no movement action until the battle times out", () => {
    const log = battle([row({ actions: [{ kind: "brute-force", tier: 3 }] })]);
    expect(log.result.winner).toBe("defender");
    expect(log.events[log.events.length - 1]!.type).toBe("battle-timeout");
  });
});

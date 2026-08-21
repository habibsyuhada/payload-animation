import { describe, expect, it } from "vitest";
import { getAlarmConfigV2 } from "../../src/nodes-v2/alarm.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInputV2, BattleLog, DefenseGraph, SheetEvent } from "../../src/types.js";

describe("getAlarmConfigV2", () => {
  it("matches docs/RULESET.md §14", () => {
    expect(getAlarmConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, alertDurationTicks: 120 });
    expect(getAlarmConfigV2(2)).toEqual({ tier: 2, radiusHops: 2, alertDurationTicks: 180 });
    expect(getAlarmConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, alertDurationTicks: 240 });
  });

  it("lengthens the alert window with tier", () => {
    expect(getAlarmConfigV2(1).alertDurationTicks).toBeLessThan(getAlarmConfigV2(3).alertDurationTicks);
  });

  it("throws on an unknown tier rather than silently returning undefined", () => {
    expect(() => getAlarmConfigV2(4 as never)).toThrow(/no v2 alarm config/);
  });
});

const MOVE_TOWARD_CORE: SheetEvent[] = [{ conditions: [], actions: [{ kind: "move-toward-core" }], children: [] }];

function run(defense: DefenseGraph, events: readonly SheetEvent[]): BattleLog {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events }, defense };
  return simulate(input);
}

describe("Alarm Relay — engine integration", () => {
  it("triggers on proximity — a status-applied event fires for the relay the tick the virus first comes within radius", () => {
    // Entry 1/2 -> router 3 -> core 4, Alarm I 5 at hop 1 from router.
    const graph: DefenseGraph = {
      nodes: [{ id: 1, type: "entry" }, { id: 2, type: "entry" }, { id: 3, type: "router" }, { id: 4, type: "core" }, { id: 5, type: "alarm", tier: 1 }],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 4, lengthDu: 900 },
        { from: 3, to: 5, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100_000,
    };
    const log = run(graph, MOVE_TOWARD_CORE);
    const arrival = log.events.find((event) => event.type === "virus-entered-node" && event.target === "3")!.tick;
    const triggers = log.events.filter((event) => event.type === "status-applied" && event.actor === "5");
    expect(triggers).toHaveLength(1); // one-shot
    // isVirusInRange treats an in-transit edge as "in range" from either endpoint (same rule ICE
    // Sentry and Scanner already use), so the relay can arm before the virus formally arrives —
    // it must fire no later than arrival, never after.
    expect(triggers[0]!.tick).toBeLessThanOrEqual(arrival);
  });

  it("triggers via Overload splash on a Breach Node the virus never gets near — proves the destroy path, not just proximity", () => {
    // Entry 1/2 -> Firewall I 3 -> Core 4. Firewall I 5 hangs off 3 (in Overload's splash radius),
    // and Alarm I 6 hangs off 5 — 2 hops from the virus's entire route (3 hops from Core, entry,
    // and every node the virus ever occupies), so proximity can never be what triggers it here.
    // Exploit III (520) one-shots Firewall 3 on arrival; two Overload III actions (320 each) then
    // splash 640 onto Firewall 5's 500 HP, destroying it in the same tick — which is the only way
    // Firewall 5 (never occupied) is destroyed at all.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
        { id: 5, type: "firewall", tier: 1 },
        { id: 6, type: "alarm", tier: 1 },
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 4, lengthDu: 300 },
        { from: 3, to: 5, lengthDu: 200 },
        { from: 5, to: 6, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100_000,
    };
    const sheet: SheetEvent[] = [
      {
        conditions: [],
        actions: [{ kind: "move-toward-core" }, { kind: "exploit", tier: 3 }, { kind: "overload", tier: 3 }, { kind: "overload", tier: 3 }],
        children: [],
      },
    ];
    const log = run(graph, sheet);
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.target === "5")).toBe(false); // never visited
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.target === "6")).toBe(false); // never visited
    const destroyedFive = log.events.find((event) => event.type === "node-destroyed" && event.target === "5")!;
    expect(log.events).toContainEqual({ tick: destroyedFive.tick, type: "status-applied", actor: "6", target: "core" });
  });

  it("boosts every ICE Sentry on the map while active: +100‰ accuracy and -1 tick fire interval", () => {
    // Tier III ICE Sentry base accuracy 900‰ + Alarm's +100‰ = 1000‰ = guaranteed hit every
    // attempt, which makes the fire cadence fully observable from the log without needing RNG luck.
    // Entry 1/2 -> router 3 -> core 4, ICE III 5 and Alarm I 6 both at hop 1 from router.
    const graph: DefenseGraph = {
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "router" },
        { id: 4, type: "core" },
        { id: 5, type: "ice-sentry", tier: 3 },
        { id: 6, type: "alarm", tier: 1 },
      ],
      edges: [
        { from: 1, to: 3, lengthDu: 300 },
        { from: 2, to: 3, lengthDu: 300 },
        { from: 3, to: 4, lengthDu: 900 },
        { from: 3, to: 5, lengthDu: 200 },
        { from: 3, to: 6, lengthDu: 200 },
      ],
      entryNodeIds: [1, 2],
      coreNodeId: 4,
      coreHp: 100_000,
    };
    const log = run(graph, MOVE_TOWARD_CORE);
    const alarmTrigger = log.events.find((event) => event.type === "status-applied" && event.actor === "6")!;
    const hits = log.events.filter((event) => event.type === "virus-damaged" && event.actor === "5").map((event) => event.tick);
    // Only ticks from the alarm's activation onward are guaranteed hits (1000‰); any shot before
    // that is still at the un-boosted 900‰ and isn't deterministic, so it's excluded here.
    const boostedHits = hits.filter((tick) => tick >= alarmTrigger.tick);
    expect(boostedHits.length).toBeGreaterThanOrEqual(3); // enough consecutive hits to read the cadence
    for (let i = 1; i < boostedHits.length; i += 1) {
      expect(boostedHits[i]! - boostedHits[i - 1]!).toBe(2); // tier III's base 3-tick interval, minus Alarm's -1
    }
  });
});

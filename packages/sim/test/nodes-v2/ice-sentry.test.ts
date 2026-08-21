import { describe, expect, it } from "vitest";
import { effectiveAccuracyPermilleV2, getIceSentryConfigV2, rollIceSentryHitV2 } from "../../src/nodes-v2/ice-sentry.js";
import { simulate } from "../../src/simulate.js";
import type { Rng } from "../../src/rng.js";
import type { BattleInputV2, DefenseGraph, SheetEvent } from "../../src/types.js";

function fakeRng(nextIntValue: number): Rng {
  return {
    seed: 0,
    nextUint32: () => {
      throw new Error("not used by rollIceSentryHitV2");
    },
    nextInt: () => nextIntValue,
  };
}

/** Seeded as an exact copy of nodes/ice-sentry.test.ts's pure-function cases (8.1b: numbers unchanged from v1). */
describe("getIceSentryConfigV2", () => {
  it("matches docs/RULESET.md §5.1", () => {
    expect(getIceSentryConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, fireIntervalTicks: 4, damage: 60, accuracyPermille: 850 });
    expect(getIceSentryConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, fireIntervalTicks: 3, damage: 115, accuracyPermille: 900 });
  });
});

describe("rollIceSentryHitV2", () => {
  it("hits when the roll lands below accuracy", () => {
    expect(rollIceSentryHitV2(fakeRng(849), 850)).toBe(true);
  });

  it("misses when the roll lands at or above accuracy", () => {
    expect(rollIceSentryHitV2(fakeRng(850), 850)).toBe(false);
    expect(rollIceSentryHitV2(fakeRng(999), 850)).toBe(false);
  });
});

describe("effectiveAccuracyPermilleV2", () => {
  it("adds the scanned bonus", () => {
    expect(effectiveAccuracyPermilleV2(850, 150)).toBe(1000);
  });

  it("never exceeds 1000‰ (it's a probability)", () => {
    expect(effectiveAccuracyPermilleV2(900, 250)).toBe(1000);
  });
});

/**
 * The "ICE Nest" fix (RULESET.md §9/§13, HANDOFF §2a, PLAN.md 8.2b): a virus takes at most one ICE
 * Sentry hit per tick, even with two overlapping sentries both able to connect. Two Tier III
 * sentries (900‰) plus an Alarm boosting them both to 1000‰ (ALARM_ICE_ACCURACY_BONUS_PERMILLE)
 * makes EVERY attempt from EITHER sentry a guaranteed hit — the only way to prove "only one lands"
 * deterministically instead of relying on seed luck.
 */
describe("ICE Nest fix — engine integration", () => {
  // Entry 1/2 -> Router 3 -> Core 4. ICE III 5 and ICE III 6 both at hop 1 from Router (radius
  // overlap on the virus); Alarm I 7 also at hop 1, arms immediately and boosts both to 1000‰.
  const graph: DefenseGraph = {
    nodes: [
      { id: 1, type: "entry" },
      { id: 2, type: "entry" },
      { id: 3, type: "router" },
      { id: 4, type: "core" },
      { id: 5, type: "ice-sentry", tier: 3 },
      { id: 6, type: "ice-sentry", tier: 3 },
      { id: 7, type: "alarm", tier: 1 },
    ],
    edges: [
      { from: 1, to: 3, lengthDu: 300 },
      { from: 2, to: 3, lengthDu: 300 },
      { from: 3, to: 4, lengthDu: 900 },
      { from: 3, to: 5, lengthDu: 200 },
      { from: 3, to: 6, lengthDu: 200 },
      { from: 3, to: 7, lengthDu: 200 },
    ],
    entryNodeIds: [1, 2],
    coreNodeId: 4,
    coreHp: 100_000,
  };
  const sheet: SheetEvent[] = [{ conditions: [], actions: [{ kind: "move-toward-core" }], children: [] }];
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events: sheet }, defense: graph };

  it("never lands two ICE hits on the same tick, even with two overlapping sentries both guaranteed to hit", () => {
    const log = simulate(input);
    const iceHitTicks = log.events.filter((event) => event.type === "virus-damaged" && (event.actor === "5" || event.actor === "6")).map((event) => event.tick);
    expect(iceHitTicks.length).toBeGreaterThan(0); // the boosted accuracy is actually being exercised
    expect(new Set(iceHitTicks).size).toBe(iceHitTicks.length); // no tick appears twice
  });

  it("caps per-tick ICE damage at one sentry's worth, not both summed", () => {
    const log = simulate(input);
    const damagePerTick = new Map<number, number>();
    for (const event of log.events) {
      if (event.type === "virus-damaged" && (event.actor === "5" || event.actor === "6")) {
        damagePerTick.set(event.tick, (damagePerTick.get(event.tick) ?? 0) + Math.abs(event.delta ?? 0));
      }
    }
    const tierIIIDamage = getIceSentryConfigV2(3).damage;
    for (const total of damagePerTick.values()) {
      // <= rather than === : damageVirus() clamps at 0 Integrity, so the tick that finally kills
      // the virus deals less than a full hit's worth — that's death, not a second sentry landing.
      expect(total).toBeLessThanOrEqual(tierIIIDamage); // never 2 * tierIIIDamage
    }
    expect([...damagePerTick.values()]).toContain(tierIIIDamage); // and it does reach the cap at least once
  });

  it("the winner is always the lower node id (5), never 6, once both are guaranteed to connect", () => {
    const log = simulate(input);
    const actors = new Set(log.events.filter((event) => event.type === "virus-damaged" && (event.actor === "5" || event.actor === "6")).map((event) => event.actor));
    expect(actors.has("5")).toBe(true);
    expect(actors.has("6")).toBe(false);
  });
});

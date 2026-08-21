import { describe, expect, it } from "vitest";
import { effectiveAccuracyPermilleV2, getIceSentryConfigV2, rollIceSentryHitV2 } from "../../src/nodes-v2/ice-sentry.js";
import type { Rng } from "../../src/rng.js";

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

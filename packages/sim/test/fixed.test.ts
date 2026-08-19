import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyPermille,
  BATTLE_TICK_LIMIT,
  clampInt,
  combinePermille,
  fromScaledPosition,
  PERMILLE_SCALE,
  POSITION_SCALE,
  TICK_MS,
  TICKS_PER_SECOND,
  ticksToCrossEdge,
  toScaledPosition,
} from "../src/fixed.js";

describe("tick/scale constants", () => {
  it("matches docs/RULESET.md §0 (1 tick = 50ms, 60s battle cap)", () => {
    expect(TICK_MS).toBe(50);
    expect(TICKS_PER_SECOND).toBe(20);
    expect(BATTLE_TICK_LIMIT).toBe(1200);
    expect(PERMILLE_SCALE).toBe(1000);
    expect(POSITION_SCALE).toBe(1000);
  });
});

describe("applyPermille", () => {
  it("1000‰ is a no-op", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (value) => {
        expect(applyPermille(value, 1000)).toBe(value);
      }),
    );
  });

  it("0‰ always yields 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (value) => {
        expect(applyPermille(value, 0)).toBe(0);
      }),
    );
  });

  it("500‰ halves (floored)", () => {
    expect(applyPermille(45, 500)).toBe(22);
    expect(applyPermille(44, 500)).toBe(22);
  });

  it("always returns an integer", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 2000 }), (value, permille) => {
        expect(Number.isInteger(applyPermille(value, permille))).toBe(true);
      }),
    );
  });
});

describe("combinePermille", () => {
  it("combining with 1000‰ (identity) returns the other operand", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), (permille) => {
        expect(combinePermille(permille, 1000)).toBe(permille);
      }),
    );
  });
});

describe("clampInt", () => {
  it("keeps values within [min, max]", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (value, boundA, boundB) => {
        const min = Math.min(boundA, boundB);
        const max = Math.max(boundA, boundB);
        const clamped = clampInt(value, min, max);
        expect(clamped).toBeGreaterThanOrEqual(min);
        expect(clamped).toBeLessThanOrEqual(max);
      }),
    );
  });
});

describe("scaled position round-trip", () => {
  it("fromScaledPosition(toScaledPosition(du)) === du for non-negative DU", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (du) => {
        expect(fromScaledPosition(toScaledPosition(du))).toBe(du);
      }),
    );
  });
});

describe("ticksToCrossEdge", () => {
  it("matches RULESET.md §0: ceil(EdgeLength / EffectiveSpeed)", () => {
    expect(ticksToCrossEdge(1000, 50)).toBe(20);
    expect(ticksToCrossEdge(999, 50)).toBe(20);
    expect(ticksToCrossEdge(1001, 50)).toBe(21);
  });

  it("rejects non-positive speed", () => {
    expect(() => ticksToCrossEdge(1000, 0)).toThrow();
    expect(() => ticksToCrossEdge(1000, -1)).toThrow();
  });
});

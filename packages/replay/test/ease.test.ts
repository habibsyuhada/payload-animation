import { describe, expect, it } from "vitest";
import { clampedMix, easeOutBack, easeOutCubic, linear, mix, mixVec2 } from "../src/ease.js";

describe("easing functions", () => {
  it("linear is the identity", () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
  });

  it("easeOutCubic starts at 0, ends at 1, and front-loads motion (faster than linear early on)", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("easeOutBack starts at 0, ends at 1, and overshoots past 1 before settling", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBe(1);
    const midValues = Array.from({ length: 20 }, (_, i) => easeOutBack((i + 1) / 20));
    expect(Math.max(...midValues)).toBeGreaterThan(1);
  });

  it("every easing function is a pure function of t (same input, same output)", () => {
    for (const fn of [linear, easeOutCubic, easeOutBack]) {
      expect(fn(0.37)).toBe(fn(0.37));
    }
  });
});

describe("mix / mixVec2 / clampedMix", () => {
  it("mix interpolates linearly", () => {
    expect(mix(0, 10, 0.5)).toBe(5);
    expect(mix(10, 20, 0)).toBe(10);
    expect(mix(10, 20, 1)).toBe(20);
  });

  it("mixVec2 interpolates both axes independently", () => {
    expect(mixVec2({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });

  it("clampedMix clamps t into [0,1] before mixing", () => {
    expect(clampedMix(0, 10, -5)).toBe(0);
    expect(clampedMix(0, 10, 5)).toBe(10);
  });
});

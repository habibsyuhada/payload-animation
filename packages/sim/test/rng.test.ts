import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng.js";

function drawSequence(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe("createRng", () => {
  it("produces an identical sequence across independent instances given the same seed", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 200 }), (seed, count) => {
        expect(drawSequence(seed, count)).toEqual(drawSequence(seed, count));
      }),
    );
  });

  it("is a pure function of the seed — draws never mutate the reported seed", () => {
    const rng = createRng(42);
    for (let i = 0; i < 50; i += 1) {
      rng.nextUint32();
    }
    expect(rng.seed).toBe(42);
  });

  it("two distinct fixed seeds diverge on the first draw", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("nextUint32 always returns a value within the 32-bit unsigned range", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const value = createRng(seed).nextUint32();
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(4294967296);
      }),
    );
  });

  it("nextInt(bound) always returns an integer within [0, bound)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 1_000_000 }), (seed, bound) => {
        const value = createRng(seed).nextInt(bound);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }),
    );
  });

  it("rejects a non-positive or non-integer bound", () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0)).toThrow();
    expect(() => rng.nextInt(-1)).toThrow();
    expect(() => rng.nextInt(1.5)).toThrow();
  });

  it("rejects a non-integer seed", () => {
    expect(() => createRng(1.5)).toThrow();
  });
});

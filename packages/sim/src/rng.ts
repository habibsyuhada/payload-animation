/**
 * Seeded PRNG (mulberry32 variant) — integer-only, no Math.random, no Date.
 * Same seed MUST produce the identical draw sequence on every platform (S1.6).
 */

const UINT32_RANGE = 4294967296; // 2^32, exact in a float64 safe integer

export interface Rng {
  readonly seed: number;
  /** Uniformly distributed integer in [0, 2^32). */
  nextUint32(): number;
  /** Uniformly distributed integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

function mulberry32Next(state: number): { output: number; nextState: number } {
  const nextState = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const output = (t ^ (t >>> 14)) >>> 0;
  return { output, nextState };
}

export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new Error("rng seed must be an integer");
  }

  let state = seed | 0;

  const nextUint32 = (): number => {
    const { output, nextState } = mulberry32Next(state);
    state = nextState;
    return output;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("maxExclusive must be a positive integer");
    }
    // Rejection sampling to avoid modulo bias.
    const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let draw = nextUint32();
    while (draw >= rejectionLimit) {
      draw = nextUint32();
    }
    return draw % maxExclusive;
  };

  return { seed, nextUint32, nextInt };
}

/**
 * Easing library, PLAN.md §11: easeOutCubic for motion, easeOutBack for impact, linear for
 * ambient flow — a small, consistent set is what gives the replay its "feel" (GDD §11).
 * Every function here is pure: same input always produces the same output, no hidden state.
 */

/** t in [0,1] -> eased value. easeOutBack can overshoot past 1 briefly, by design. */
export type EasingFn = (t: number) => number;

export const linear: EasingFn = (t) => t;

export const easeOutCubic: EasingFn = (t) => 1 - (1 - t) ** 3;

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

export const easeOutBack: EasingFn = (t) => 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2;

/** Linear interpolation between two numbers. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function mixVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
}

/** Clamps t into [0,1] before mixing — most callers want this instead of raw extrapolation. */
export function clampedMix(a: number, b: number, t: number): number {
  return mix(a, b, Math.max(0, Math.min(1, t)));
}

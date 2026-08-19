/**
 * Fixed-point helpers per docs/RULESET.md §0. Integer-only math — no floats reach
 * gameplay state, so results are identical bit-for-bit across platforms.
 */

/** 1 tick = 50ms → 20 ticks/second. */
export const TICK_MS = 50;
export const TICKS_PER_SECOND = 1000 / TICK_MS;

/** Battle hard cap: 60 in-game seconds. Timeout past this tick favors the defender. */
export const BATTLE_TICK_LIMIT = 60 * TICKS_PER_SECOND;

/** Ratios/modifiers (accuracy, damage reduction, …) are expressed per-mille: 1000‰ = 100%. */
export const PERMILLE_SCALE = 1000;

/** Internal replay-position precision: 1 DU = 1000 internal units (sub-DU interpolation only). */
export const POSITION_SCALE = 1000;

/** Applies a per-mille modifier to an integer value, flooring toward zero. */
export function applyPermille(value: number, permille: number): number {
  return Math.floor((value * permille) / PERMILLE_SCALE);
}

/** Combines two per-mille modifiers (e.g. stacking accuracy/damage bonuses). */
export function combinePermille(a: number, b: number): number {
  return Math.floor((a * b) / PERMILLE_SCALE);
}

/** Clamps an integer into [min, max]. */
export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Converts a Distance Unit (DU) length into the internal sub-DU position scale. */
export function toScaledPosition(du: number): number {
  return du * POSITION_SCALE;
}

/** Converts an internal sub-DU position back into whole DU (floored). */
export function fromScaledPosition(scaled: number): number {
  return Math.floor(scaled / POSITION_SCALE);
}

/** Ticks needed to cross an edge of the given length at the given speed (DU/tick). */
export function ticksToCrossEdge(edgeLengthDu: number, speedDuPerTick: number): number {
  if (speedDuPerTick <= 0) {
    throw new Error("speedDuPerTick must be positive");
  }
  return Math.ceil(edgeLengthDu / speedDuPerTick);
}

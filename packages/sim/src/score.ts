import { BATTLE_TICK_LIMIT } from "./fixed.js";
import type { Score } from "./types.js";

/**
 * Scoring is ruleset-independent (docs/RULESET.md §8): both engines report the same numbers for
 * the same outcome, so a v1 log and a v2 log stay comparable on a leaderboard. It lives in its
 * own module rather than inside engine.ts so engine-v2.ts can use it without importing the frozen
 * v1 engine.
 */

export interface ScoreParams {
  readonly integrityRatioPermille: number;
  readonly coreRatioPermille: number;
  readonly nodesDestroyed: number;
  readonly ticksElapsed: number;
}

export function computeScore(winner: "attacker" | "defender", params: ScoreParams): Score {
  const timeBonus = Math.max(0, Math.floor((BATTLE_TICK_LIMIT - params.ticksElapsed) / 4));
  const base = winner === "attacker" ? 500 : 300;
  const ratio = winner === "attacker" ? params.integrityRatioPermille : params.coreRatioPermille;
  const value = base + Math.floor((ratio * 300) / 1000) + params.nodesDestroyed * 40 + timeBonus;
  return {
    value,
    integrityRatioPermille: params.integrityRatioPermille,
    coreRatioPermille: params.coreRatioPermille,
    nodesDestroyed: params.nodesDestroyed,
    timeBonus,
  };
}

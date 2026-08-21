import { getIceSentryConfigV2 } from "../ruleset-v2.js";
import type { Rng } from "../rng.js";
import type { BlockTier, DefenseNodeType } from "../types.js";

/** ICE Sentry — Shoot class: ranged, fires on a per-node cooldown at any virus within its hop radius. */
export const NODE_TYPE: DefenseNodeType = "ice-sentry";

export { getIceSentryConfigV2 };

/** True if a fire roll (RNG per RULESET.md §11a draw order) lands a hit, given a possibly status-boosted accuracy. */
export function rollIceSentryHitV2(rng: Rng, accuracyPermille: number): boolean {
  return rng.nextInt(1000) < accuracyPermille;
}

/** Accuracy after Scanner's "scanned" bonus and Slow Crawl's reduction (clamped — accuracy is a probability, [0, 1000]‰). */
export function effectiveAccuracyPermilleV2(baseAccuracyPermille: number, scannedBonusPermille: number, slowCrawlReductionPermille = 0): number {
  return Math.max(0, Math.min(1000, baseAccuracyPermille + scannedBonusPermille - slowCrawlReductionPermille));
}

export function iceSentryDamageV2(tier: BlockTier): number {
  return getIceSentryConfigV2(tier).damage;
}

import { getIceSentryConfig } from "../ruleset.js";
import type { Rng } from "../rng.js";
import type { BlockTier } from "../types.js";

/** ICE Sentry — Shoot class: ranged, fires on a per-node cooldown at any virus within its hop radius. */

export { getIceSentryConfig };

/** True if a fire roll (RNG per RULESET.md §0 draw order) lands a hit, given a possibly status-boosted accuracy. */
export function rollIceSentryHit(rng: Rng, accuracyPermille: number): boolean {
  return rng.nextInt(1000) < accuracyPermille;
}

/** Accuracy after Scanner's "scanned" bonus and Slow Crawl's reduction (clamped — accuracy is a probability, [0, 1000]‰). */
export function effectiveAccuracyPermille(baseAccuracyPermille: number, scannedBonusPermille: number, slowCrawlReductionPermille = 0): number {
  return Math.max(0, Math.min(1000, baseAccuracyPermille + scannedBonusPermille - slowCrawlReductionPermille));
}

export function iceSentryDamage(tier: BlockTier): number {
  return getIceSentryConfig(tier).damage;
}

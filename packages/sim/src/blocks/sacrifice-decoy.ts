import { SACRIFICE_DECOY_THRESHOLD_STEP_PERMILLE, getSacrificeDecoyConfig } from "../ruleset.js";

/** Sacrifice Decoy — Utility: absorbs the next ICE Sentry/Honeypot/Trap trigger once Integrity crosses a re-arming threshold. */
export { getSacrificeDecoyConfig };

/**
 * True once Integrity has dropped to/below the next arm threshold and a charge is still available.
 * Re-arming is a flat SACRIFICE_DECOY_THRESHOLD_STEP_PERMILLE (20%) below the last trigger point
 * (RULESET.md §4.2), starting from 1000‰ (full) so the very first threshold is 800‰... except
 * §4.2 states the first check is explicitly "turun ≤200 (20%)", so the engine seeds
 * nextThresholdPermille at 200, not 800 — see engine.ts's decoy state initialization.
 */
export function shouldArmSacrificeDecoy(currentIntegrityPermille: number, nextThresholdPermille: number, chargesRemaining: number): boolean {
  return chargesRemaining > 0 && currentIntegrityPermille <= nextThresholdPermille;
}

export function nextSacrificeDecoyThreshold(previousThresholdPermille: number): number {
  return previousThresholdPermille - SACRIFICE_DECOY_THRESHOLD_STEP_PERMILLE;
}

import { getTrapDamage } from "../ruleset.js";
import type { BlockTier } from "../types.js";

/** Trap Node — Trigger class: one-shot damage on first entry, then converts to an inert Router for the rest of the battle. */
export function trapTriggerDamage(tier: BlockTier): number {
  return getTrapDamage(tier);
}

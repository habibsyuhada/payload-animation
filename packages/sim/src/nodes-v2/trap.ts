import { getTrapDamageV2 } from "../ruleset-v2.js";
import type { BlockTier, DefenseNodeType } from "../types.js";

/** Trap Node — Trigger class: one-shot damage on first entry, then converts to an inert Router for the rest of the battle. */
export const NODE_TYPE: DefenseNodeType = "trap";

export function trapTriggerDamageV2(tier: BlockTier): number {
  return getTrapDamageV2(tier);
}

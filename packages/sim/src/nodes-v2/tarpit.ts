import { getTarpitConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Tarpit — Aura (debuff) class, v2-only (RULESET.md §14): slows any virus within radius. Does
 * NOT stack with a second Tarpit in range — the caller (engine-v2.ts) takes the strongest (lowest
 * ‰) active multiplier, never multiplies two together. Answers `sprint`/pure-speed builds that
 * would otherwise out-run every other defense's reaction window.
 */
export const NODE_TYPE: DefenseNodeType = "tarpit";

export { getTarpitConfigV2 };

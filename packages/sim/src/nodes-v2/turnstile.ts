import { getTurnstileConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Turnstile — Structural class, v2-only (RULESET.md §14): indestructible, like Router. A virus
 * that departs a Turnstile can't re-enter it for a tier-scaled tick window — engine-v2.ts tracks
 * this per node, not per edge, so it blocks every movement kind equally (`move-back`, a future
 * `recall`, or simply pathfinding routing back through it), not just the one action that names it.
 */
export const NODE_TYPE: DefenseNodeType = "turnstile";

export { getTurnstileConfigV2 };

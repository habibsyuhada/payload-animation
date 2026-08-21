import { getAlarmConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Alarm Relay — Trigger→Aura class, v2-only (RULESET.md §14): each relay fires at most once per
 * battle (Trigger half, like Honeypot/Trap), either when a virus first comes within radius or a
 * Breach Node within radius is destroyed. Firing raises a network-wide alert (Aura half) that
 * boosts every ICE Sentry on the map for a tier-scaled duration. Multiple relays firing (or one
 * refiring while already active — which can't happen, since it's one-shot per relay, but two
 * different relays overlapping can) do NOT stack the boost; engine-v2.ts extends the alert window
 * to the longer remaining duration instead of adding a second one on top.
 */
export const NODE_TYPE: DefenseNodeType = "alarm";

export { getAlarmConfigV2 };

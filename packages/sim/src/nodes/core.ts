import { BREACH_PASSIVE_DRAIN_V1 } from "../ruleset.js";

/** Core — Breach class, like Firewall, but never counters and reaching HP 0 ends the battle. */

export interface CoreTickResult {
  readonly remainingHp: number;
  readonly destroyed: boolean;
}

export function resolveCoreTick(currentHp: number): CoreTickResult {
  const remainingHp = Math.max(0, currentHp - BREACH_PASSIVE_DRAIN_V1);
  return { remainingHp, destroyed: remainingHp <= 0 };
}

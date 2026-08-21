import { BREACH_PASSIVE_DRAIN_V2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/** Core — Breach class, like Firewall, but never counters and reaching HP 0 ends the battle. */
export const NODE_TYPE: DefenseNodeType = "core";

export interface CoreTickResultV2 {
  readonly remainingHp: number;
  readonly destroyed: boolean;
}

export function resolveCoreTickV2(currentHp: number): CoreTickResultV2 {
  const remainingHp = Math.max(0, currentHp - BREACH_PASSIVE_DRAIN_V2);
  return { remainingHp, destroyed: remainingHp <= 0 };
}

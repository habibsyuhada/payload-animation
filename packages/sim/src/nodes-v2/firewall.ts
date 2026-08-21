import { BREACH_PASSIVE_DRAIN_V2, getFirewallConfigV2 } from "../ruleset-v2.js";
import type { BlockTier, DefenseNodeType } from "../types.js";

/** Firewall — Breach class (RULESET.md §5.0/§5.1): blocks the path until HP reaches 0. */
export const NODE_TYPE: DefenseNodeType = "firewall";

export function firewallMaxHpV2(tier: BlockTier): number {
  return getFirewallConfigV2(tier).hp;
}

export interface FirewallTickResultV2 {
  readonly remainingHp: number;
  readonly counterDamageToVirus: number;
  readonly destroyed: boolean;
}

/** One tick of virus occupancy: passive drain reduces the Firewall's HP, it counters every tick regardless. */
export function resolveFirewallTickV2(currentHp: number, tier: BlockTier): FirewallTickResultV2 {
  const config = getFirewallConfigV2(tier);
  const remainingHp = Math.max(0, currentHp - BREACH_PASSIVE_DRAIN_V2);
  return { remainingHp, counterDamageToVirus: config.counterDamagePerTick, destroyed: remainingHp <= 0 };
}

import { BREACH_PASSIVE_DRAIN_V1, getFirewallConfig } from "../ruleset.js";
import type { BlockTier } from "../types.js";

/** Firewall — Breach class (RULESET.md §5.0/§5.1): blocks the path until HP reaches 0. */

export function firewallMaxHp(tier: BlockTier): number {
  return getFirewallConfig(tier).hp;
}

export interface FirewallTickResult {
  readonly remainingHp: number;
  readonly counterDamageToVirus: number;
  readonly destroyed: boolean;
}

/** One tick of virus occupancy: passive drain reduces the Firewall's HP, it counters every tick regardless. */
export function resolveFirewallTick(currentHp: number, tier: BlockTier): FirewallTickResult {
  const config = getFirewallConfig(tier);
  const remainingHp = Math.max(0, currentHp - BREACH_PASSIVE_DRAIN_V1);
  return { remainingHp, counterDamageToVirus: config.counterDamagePerTick, destroyed: remainingHp <= 0 };
}

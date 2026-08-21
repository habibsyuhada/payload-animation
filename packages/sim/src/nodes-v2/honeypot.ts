import type { DefenseNodeType } from "../types.js";

/**
 * Honeypot — Trigger class: lethal on first entry, resolved one tick after arrival
 * (RULESET.md §5.1: "Integrity → 0 di tick berikutnya").
 *
 * v2 semantics differ from v1's `honeypotIsLethal` (ADR 0006 §8): detection stops granting
 * immunity. `honeypot-near` is a condition now — the sheet decides what to do with it — so the
 * only thing that can still save a virus that walks in is an armed Sacrifice Decoy.
 */
export const NODE_TYPE: DefenseNodeType = "honeypot";

export function honeypotIsLethalV2(hasSacrificeDecoyCharge: boolean): boolean {
  return !hasSacrificeDecoyCharge;
}

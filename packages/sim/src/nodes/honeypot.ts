/**
 * Honeypot — Trigger class: lethal on first entry, resolved one tick after arrival
 * (RULESET.md §5.1: "Integrity → 0 di tick berikutnya").
 *
 * S1.4 scope: Detect Honeypot (Sensor) and Sacrifice Decoy (Utility) don't exist until S1.5, so
 * `hasDetectHoneypot`/`hasSacrificeDecoyCharge` are always false and every Honeypot entry is
 * lethal. The predicate already takes both params so S1.5 only has to pass real values in.
 */
export function honeypotIsLethal(hasDetectHoneypot: boolean, hasSacrificeDecoyCharge: boolean): boolean {
  return !hasDetectHoneypot && !hasSacrificeDecoyCharge;
}

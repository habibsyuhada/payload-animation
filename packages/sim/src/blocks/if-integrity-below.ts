import { DEFAULT_INTEGRITY_THRESHOLD_PERMILLE } from "../ruleset.js";

/** IF Integrity < X% — Condition: gates the immediately-following block in the chain. */
export function evaluateIfIntegrityBelow(currentIntegrityPermille: number, thresholdPermille = DEFAULT_INTEGRITY_THRESHOLD_PERMILLE): boolean {
  return currentIntegrityPermille < thresholdPermille;
}

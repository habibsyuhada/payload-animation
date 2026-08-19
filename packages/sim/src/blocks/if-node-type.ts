import { DEFAULT_CONDITION_TARGET_NODE_TYPES } from "../ruleset.js";
import type { DefenseNodeType } from "../types.js";

/**
 * IF Node = Firewall — Condition: gates the immediately-following block (an Attack block, in
 * practice) by the type of the node the virus currently occupies. RULESET.md §4.2 phrases this
 * as "node tujuan" (destination), but since gated blocks (Brute Force/Exploit/Overload) only
 * ever apply while occupying a Breach node — never in anticipation of one — evaluating against
 * the CURRENT node is the coherent reading: it's what makes "IF Firewall → Exploit" actually
 * fire the moment Exploit's own one-shot-on-entry condition is satisfied.
 */
export function evaluateIfNodeType(
  currentNodeType: DefenseNodeType | null,
  targetNodeTypes: readonly DefenseNodeType[] = DEFAULT_CONDITION_TARGET_NODE_TYPES,
): boolean {
  return currentNodeType !== null && targetNodeTypes.includes(currentNodeType);
}

import { simulateV1 } from "./engine.js";
import { simulateV2 } from "./engine-v2.js";
import type { BattleInput, BattleLog } from "./types.js";

/**
 * The one entry point callers use. Dispatch is on the input's own `rulesetVersion` (ADR 0006 §7),
 * which is also what a stored BattleLog carries — so replaying a two-year-old log picks the engine
 * that produced it, and a ruleset rewrite can never silently reinterpret it.
 */
export function simulate(input: BattleInput): BattleLog {
  return input.rulesetVersion === "v2" ? simulateV2(input) : simulateV1(input);
}

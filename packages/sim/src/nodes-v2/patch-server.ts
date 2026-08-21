import { getPatchServerConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Patch Server — Aura (support) class, v2-only (RULESET.md §14): heals Breach Nodes (Firewall
 * alive, Core) within radius every tick. Never heals itself — it has no HP to lose in that sense
 * (it isn't a Breach Node), and the table doesn't price it as destructible via this healing loop.
 * Answers grind: a virus with no burst damage (no Exploit/Overload) that would otherwise slowly
 * out-drain a Firewall via passive drain alone now has to out-race the heal too.
 */
export const NODE_TYPE: DefenseNodeType = "patch-server";

export { getPatchServerConfigV2 };

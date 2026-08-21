import { getJammerConfigV2 } from "../ruleset-v2.js";
import type { DefenseNodeType } from "../types.js";

/**
 * Jammer — Aura (blind) class, v2-only (RULESET.md §14): while a virus is within radius, every
 * sensor condition (`honeypot-near`, `trap-near`) reads false, and tier III also falsifies
 * `node-ahead-is`. The one node in this expansion that attacks the virus's LANGUAGE rather than
 * its body (GDD Pillar 1: "tidak ada RNG tersembunyi yang tidak bisa dijelaskan replay" — this
 * isn't hidden randomness, it's a visible, explainable blind spot the sheet can react to via the
 * `jammed` condition, 8.4).
 */
export const NODE_TYPE: DefenseNodeType = "jammer";

export { getJammerConfigV2 };

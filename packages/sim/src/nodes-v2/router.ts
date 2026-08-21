import type { DefenseNodeType } from "../types.js";

/**
 * Router — Structural class (RULESET.md §5.0): pure pass-through, no combat effect, no HP.
 * Intentionally has no logic to export beyond its type marker — the engine's default behavior for
 * any node it doesn't special-case IS Router behavior, same as v1's nodes/router.ts. This file
 * exists for 1:1 symmetry with the other node types in nodes-v2/.
 */
export const NODE_TYPE: DefenseNodeType = "router";

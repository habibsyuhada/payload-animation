/**
 * Router — Structural class (RULESET.md §5.0): pure pass-through, no combat effect, no HP.
 * Intentionally has no logic to export — the engine's default behavior for any node it doesn't
 * special-case IS Router behavior. This file exists for 1:1 symmetry with the other 6 node types
 * per PLAN.md's packages/sim/src/nodes/ layout; see test/nodes/router.test.ts for the coverage
 * that proves the engine actually treats it (and a spent Trap / destroyed Firewall) this way.
 */
export {};

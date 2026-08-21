import type { ActionKind, BlockTier, ConditionKind, DefenseNodeType } from "@payload/sim";

/**
 * research.ts — PLAN.md 8.6, ADR 0009: the tree that gates every sheet condition/action and every
 * defense node×tier, unlocked with a local currency (`Data`).
 *
 * Lives in `packages/shared`, not `packages/sim` (ADR 0009 §A): research is never read by
 * `engine-v2.ts` — it's client-side gating, not battle physics. `packages/sim` stays pure so a
 * server can validate a `BattleLog` without knowing anything about the player who produced it, and
 * `tools/balance-lab` can keep measuring raw ruleset balance without research getting in the way.
 * The one exception to `shared`'s usual isolation: it DOES import sim's `ConditionKind`/
 * `ActionKind`/`DefenseNodeType`, because retyping them here would recreate exactly the
 * katalog-cermin `sheetCatalog.ts` already goes out of its way to avoid (`eslint.config.js`
 * `{ from: "shared", allow: ["sim"] }`).
 */

export type ResearchBranch = "inti" | "serbuan" | "bayangan" | "pengintaian" | "replikasi";

/**
 * What completing a `ResearchNode` grants. `tier` follows one rule, load-bearing for
 * `unlockedSet()` (`unlocks.ts`): **omitted = the kind itself becomes usable at its lowest tier**
 * (tier 1 for a tiered kind; irrelevant for an untiered one). A later node for the SAME kind that
 * DOES carry a `tier` raises the ceiling to that tier and every tier below it — it is a threshold,
 * not a per-tier toggle, so unlocking tier 3 does not also require a separate tier-2 unlock to have
 * happened first. `defense-node` always carries `tier` for every node type that has one (§14 —
 * router is the only untiered placeable node), because RULESET.md's own completeness rule treats
 * every `(DefenseNodeType, tier)` pair as its own unit, unlike conditions/actions.
 */
export type Unlock =
  | { readonly kind: "condition"; readonly condition: ConditionKind }
  | { readonly kind: "action"; readonly action: ActionKind; readonly tier?: BlockTier }
  | { readonly kind: "defense-node"; readonly node: DefenseNodeType; readonly tier?: BlockTier };

export interface ResearchNode {
  /** Stable, human-legible id — "serbuan.exploit.3", not a counter. Never regenerated: it is what
   * `ResearchState.completed` stores, so changing an id orphans every player who already has it. */
  readonly id: string;
  readonly branch: ResearchBranch;
  /** 0 = Inti's free starter set. 1-4 = the pita kedalaman `tools/balance-lab` (PLAN.md 8.8)
   * measures winrate bands against — depth is a balance axis, not just a UI indent level. */
  readonly depth: 0 | 1 | 2 | 3 | 4;
  readonly name: string;
  readonly summary: string;
  /** `Data`. 0 for every depth-0 Inti node — those are the free starter set, not a "cheap" price. */
  readonly costData: number;
  /** Other `ResearchNode.id`s that must be in `completed` first. Empty for a tree root. */
  readonly requires: readonly string[];
  readonly unlocks: readonly Unlock[];
  /** Hook for GDD §9's "duplicate blueprint from loot" — unused until loot exists (Fase 6+). */
  readonly requiresBlueprints?: number;
}

/**
 * What a player has actually done. Deliberately thin and already shaped like the payload a future
 * server would store (ADR 0009 §B): `completed` is a list of IDs, never a list of unlocks — what a
 * given node unlocks is looked up fresh from `RESEARCH_TREE` every time (`unlockedSet()`), so
 * rebalancing a node's `unlocks` in a later patch takes effect for existing players with no
 * migration. **Not tamper-proof**: this lives in `localStorage` (ADR 0009 §C) and PLAN.md M5.1
 * stays unchecked until a server can validate it.
 */
export interface ResearchState {
  readonly version: 1;
  readonly data: number;
  readonly completed: readonly string[];
  /** Data source id -> the tick (client `Date.now()`, not a battle tick) it was last claimed —
   * lets a daily/one-shot source (PLAN.md 8.7) tell "already claimed today" from "never claimed". */
  readonly claimed: Readonly<Record<string, number>>;
}

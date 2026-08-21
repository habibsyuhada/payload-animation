import type { ActionKind, BlockTier, ConditionKind, DefenseNodeType } from "@payload/sim";
import type { ResearchNode, ResearchState } from "./research.js";

/**
 * unlocks.ts — pure functions over `ResearchNode`/`ResearchState` (PLAN.md 8.6, ADR 0009). Nothing
 * here touches storage or React; `apps/client/src/logic/unlocks.ts` (PLAN.md 8.7) is the thin
 * client-side wrapper that does. Kept pure and dependency-free so a future server can import the
 * exact same functions to validate a submitted sheet/layout, instead of re-implementing the rule.
 */

/** The derived, queryable form of a completed-id list — computed fresh every time rather than
 * cached in `ResearchState` itself, so rebalancing a node's `unlocks` in a later patch takes effect
 * for existing players immediately (ADR 0009 §B). */
export interface UnlockedSet {
  readonly conditions: ReadonlySet<ConditionKind>;
  readonly actions: ReadonlySet<ActionKind>;
  /** Highest tier explicitly unlocked per action kind. A kind present in `actions` but absent here
   * is usable at tier 1 only (research.ts's "omitted tier = lowest tier" rule). */
  readonly actionMaxTier: ReadonlyMap<ActionKind, BlockTier>;
  readonly defenseNodes: ReadonlySet<DefenseNodeType>;
  readonly defenseNodeMaxTier: ReadonlyMap<DefenseNodeType, BlockTier>;
}

export function unlockedSet(completed: readonly string[], tree: readonly ResearchNode[]): UnlockedSet {
  const conditions = new Set<ConditionKind>();
  const actions = new Set<ActionKind>();
  const actionMaxTier = new Map<ActionKind, BlockTier>();
  const defenseNodes = new Set<DefenseNodeType>();
  const defenseNodeMaxTier = new Map<DefenseNodeType, BlockTier>();
  const completedIds = new Set(completed);

  for (const node of tree) {
    if (!completedIds.has(node.id)) {
      continue;
    }
    for (const unlock of node.unlocks) {
      if (unlock.kind === "condition") {
        conditions.add(unlock.condition);
      } else if (unlock.kind === "action") {
        actions.add(unlock.action);
        if (unlock.tier !== undefined && unlock.tier > (actionMaxTier.get(unlock.action) ?? 1)) {
          actionMaxTier.set(unlock.action, unlock.tier);
        }
      } else {
        defenseNodes.add(unlock.node);
        if (unlock.tier !== undefined && unlock.tier > (defenseNodeMaxTier.get(unlock.node) ?? 1)) {
          defenseNodeMaxTier.set(unlock.node, unlock.tier);
        }
      }
    }
  }
  return { conditions, actions, actionMaxTier, defenseNodes, defenseNodeMaxTier };
}

export function isConditionUnlocked(unlocked: UnlockedSet, kind: ConditionKind): boolean {
  return unlocked.conditions.has(kind);
}

export function isActionUnlocked(unlocked: UnlockedSet, kind: ActionKind, tier: BlockTier = 1): boolean {
  return unlocked.actions.has(kind) && tier <= (unlocked.actionMaxTier.get(kind) ?? 1);
}

export function isDefenseNodeUnlocked(unlocked: UnlockedSet, type: DefenseNodeType, tier?: BlockTier): boolean {
  if (!unlocked.defenseNodes.has(type)) {
    return false;
  }
  return tier === undefined || tier <= (unlocked.defenseNodeMaxTier.get(type) ?? 1);
}

/** Whether `node` can be researched right now: every prerequisite completed, enough `Data`, and not
 * already completed (re-completing a node is meaningless — nothing in `ResearchState` tracks "how
 * many times"). */
export function canResearch(node: ResearchNode, state: ResearchState): boolean {
  return !state.completed.includes(node.id) && state.data >= node.costData && node.requires.every((id) => state.completed.includes(id));
}

export function researchNodeFor(tree: readonly ResearchNode[], id: string): ResearchNode | undefined {
  return tree.find((node) => node.id === id);
}

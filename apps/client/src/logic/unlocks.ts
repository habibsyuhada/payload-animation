import type { ActionKind, BlockTier, ConditionKind, DefenseNodeType, SheetEvent, VirusProgram } from "@payload/sim";
import { RESEARCH_TREE, isActionUnlocked, isConditionUnlocked, isDefenseNodeUnlocked, unlockedSet, type ResearchNode, type UnlockedSet } from "@payload/shared";
import type { DefendNode } from "../state/defendStore.js";
import type { RowInstance } from "../state/virusLabStore.js";

/**
 * logic/unlocks.ts — PLAN.md 8.7, ADR 0009 §C: the thin client-side wrapper around
 * `@payload/shared`'s pure `unlocks.ts`. Nothing here is sim rule validation — `validateVirusProgram()`
 * (`packages/sim`) still owns budget/nesting/threshold checks and knows nothing about research.
 * This file is a SEPARATE, later gate: "is this sheet legal to author" vs. "has this player earned
 * the right to author it".
 */

export type { UnlockedSet } from "@payload/shared";

/** Re-derives the queryable unlock set from a completed-id list — cheap enough (102 nodes) to call
 * fresh on every render rather than caching it in the store (ADR 0009 §B: rebalancing a node's
 * `unlocks` must take effect immediately, which a cached derivation would fight). */
export function unlocked(completed: readonly string[]): UnlockedSet {
  return unlockedSet(completed, RESEARCH_TREE);
}

export { isActionUnlocked, isConditionUnlocked, isDefenseNodeUnlocked };

/**
 * The research node whose completion is this kind's FIRST unlock (tier omitted) — what a picker
 * jumps to when the player taps a locked entry (PLAN.md 8.4/8.7's "menyentuhnya membuka layar Riset
 * yang sudah ter-scroll ke simpul itu"). Every kind has exactly one such node (research.test.ts's
 * own completeness check), so this never falls through to `undefined` for a real kind.
 */
export function baseResearchNodeIdForCondition(kind: ConditionKind): string | undefined {
  return RESEARCH_TREE.find((node) => node.unlocks.some((unlock) => unlock.kind === "condition" && unlock.condition === kind))?.id;
}

export function baseResearchNodeIdForAction(kind: ActionKind): string | undefined {
  return RESEARCH_TREE.find((node) => node.unlocks.some((unlock) => unlock.kind === "action" && unlock.action === kind && unlock.tier === undefined))?.id;
}

export function baseResearchNodeIdForDefenseNode(type: DefenseNodeType, tier: BlockTier | undefined): string | undefined {
  return RESEARCH_TREE.find((node) => node.unlocks.some((unlock) => unlock.kind === "defense-node" && unlock.node === type && (unlock.tier ?? 1) === (tier ?? 1)))?.id;
}

export interface UnlockIssue {
  readonly code: "condition-locked" | "action-locked" | "action-tier-locked";
  readonly message: string;
  readonly path: string;
}

/**
 * Walks a compiled `VirusProgram` for anything the player hasn't researched yet. Deliberately
 * separate from `validateVirusProgram()` (packages/sim) — the sim validator must stay ignorant of
 * research (ADR 0009 §A), so this returns its own issue list rather than folding into the sim's.
 * `apps/client` callers merge the two lists for display, same shape (`{ code, message }`) so the
 * existing error/warning rendering in VirusLab.tsx needs no branching to show either kind.
 */
export function validateAgainstUnlocks(program: VirusProgram, unlockedState: UnlockedSet): UnlockIssue[] {
  const issues: UnlockIssue[] = [];

  function walk(events: readonly SheetEvent[], prefix: string): void {
    events.forEach((event, index) => {
      const path = prefix === "" ? String(index) : `${prefix}.${index}`;
      for (const condition of event.conditions) {
        if (!isConditionUnlocked(unlockedState, condition.kind)) {
          issues.push({ code: "condition-locked", path, message: `Kondisi belum diriset: ${condition.kind}` });
        }
      }
      for (const action of event.actions) {
        const tier: BlockTier = action.tier ?? 1;
        if (!isActionUnlocked(unlockedState, action.kind)) {
          issues.push({ code: "action-locked", path, message: `Aksi belum diriset: ${action.kind}` });
        } else if (!isActionUnlocked(unlockedState, action.kind, tier)) {
          issues.push({ code: "action-tier-locked", path, message: `Aksi ${action.kind} belum diriset sampai Tier ${tier}` });
        }
      }
      walk(event.children, path);
    });
  }

  walk(program.events, "");
  return issues;
}

/** Every `ResearchNode` id whose `unlocks` cover a used condition, or an action/defense-node at or
 * below a used tier — i.e. exactly what has to be `completed` for that usage to read as unlocked
 * (`isActionUnlocked`/`isDefenseNodeUnlocked`'s own "highest completed tier" rule). Shared by the
 * migration (grant what's already in use) and, will be reused by 8.8 balance tooling if it ever
 * needs the inverse lookup. */
function nodesCovering(predicate: (node: ResearchNode) => boolean): readonly string[] {
  return RESEARCH_TREE.filter(predicate).map((node) => node.id);
}

/** The Inti (depth 0) node ids — free, `requires: []`, and what every player has researched by
 * definition (PLAN.md §C.2). `researchStore`'s `reset()` seeds from this rather than an empty list,
 * so wiping progress lands back on the same baseline a brand-new install migrates to, not on a
 * state where the starter sheet itself reads as unresearched. */
export function intiStarterIds(): readonly string[] {
  return nodesCovering((node) => node.depth === 0);
}

/**
 * ADR 0009 §D: the one-time migration a player who already had a sheet/layout before research
 * existed must receive, so gating never makes their own existing work look "illegal". Returns the
 * full `completed` list a fresh `ResearchState` should start from — the Inti starter set PLUS
 * whatever this device's already-saved sheet and layout actually use.
 *
 * Deliberately does not walk `requires` chains to backfill skipped prerequisites (e.g. a saved
 * sheet using `slow-crawl` without ever having used `cloak` grants `slow-crawl`'s own node but not
 * `cloak`'s) — a real but harmless gap: nothing here re-checks `requires` at runtime, only
 * `unlockedSet`'s own coverage, so the missing prerequisite only ever shows up as "still
 * researchable" in the Research screen, never as a broken/relocked feature.
 */
export function starterCompletedIds(rows: readonly RowInstance[], defendNodes: readonly DefendNode[]): string[] {
  const ids = new Set<string>(intiStarterIds());

  function walkRows(list: readonly RowInstance[]): void {
    for (const row of list) {
      for (const condition of row.conditions) {
        for (const id of nodesCovering((node) => node.unlocks.some((unlock) => unlock.kind === "condition" && unlock.condition === condition.kind))) {
          ids.add(id);
        }
      }
      for (const action of row.actions) {
        const tier = action.tier;
        for (const id of nodesCovering((node) => node.unlocks.some((unlock) => unlock.kind === "action" && unlock.action === action.kind && (unlock.tier ?? 1) <= tier))) {
          ids.add(id);
        }
      }
      walkRows(row.children);
    }
  }
  walkRows(rows);

  for (const node of defendNodes) {
    if (node.type === "entry" || node.type === "core") {
      continue; // Structural, page-priced (defendStore.ts) — never in the research tree at all.
    }
    const type: DefenseNodeType = node.type;
    const tier = node.tier ?? 1;
    for (const id of nodesCovering((candidate) => candidate.unlocks.some((unlock) => unlock.kind === "defense-node" && unlock.node === type && (unlock.tier ?? 1) <= tier))) {
      ids.add(id);
    }
  }

  return [...ids];
}

import { RESEARCH_TREE } from "@payload/shared";
import type { ActionKind, BlockTier, ConditionKind, DefenseGraph, DefenseNodeType, SheetEvent, VirusProgram } from "@payload/sim";

/**
 * PLAN.md 8.8's "pita kedalaman riset" — how deep into the research tree a sheet or a defense
 * graph actually reaches, derived from the SAME tree the client gates unlocks against
 * (`packages/shared/src/research-tree.ts`), not a second hand-maintained table. A depth-1 sheet
 * and a depth-4 defense never having to fight each other is the whole point of banding — this
 * module answers "how deep is this build", `dominance.ts` answers "did depth ≤ D dominate".
 *
 * Conditions are unlocked as a whole kind, tier-independent (`isConditionUnlocked` takes no tier
 * argument) — a condition's own `tier` field is sensor RADIUS, not a research gate, so only kind
 * matters. Actions and defense nodes gate by tier: `research-tree.ts`'s own convention is that a
 * node's `unlocks[].tier` is a THRESHOLD (research.ts's doc comment), so the depth "required" for
 * tier N is the SHALLOWEST node whose threshold already covers N — deeper alternatives exist only
 * because the tree's own `requires` chains force them, and `depth` already encodes that chain
 * (research-tree.ts's own structure note), so there is no need to walk `requires` here too.
 */

const MAX_DEPTH = 4;

function conditionDepth(kind: ConditionKind): number {
  const node = RESEARCH_TREE.find((candidate) => candidate.unlocks.some((unlock) => unlock.kind === "condition" && unlock.condition === kind));
  return node?.depth ?? 0;
}

function actionDepth(kind: ActionKind, tier: BlockTier): number {
  const candidates = RESEARCH_TREE.filter((candidate) => candidate.unlocks.some((unlock) => unlock.kind === "action" && unlock.action === kind && (unlock.tier ?? 1) >= tier));
  return candidates.length > 0 ? Math.min(...candidates.map((candidate) => candidate.depth)) : 0;
}

function defenseNodeDepth(type: DefenseNodeType, tier: BlockTier | undefined): number {
  const wantedTier = tier ?? 1;
  const candidates = RESEARCH_TREE.filter((candidate) => candidate.unlocks.some((unlock) => unlock.kind === "defense-node" && unlock.node === type && (unlock.tier ?? 1) >= wantedTier));
  return candidates.length > 0 ? Math.min(...candidates.map((candidate) => candidate.depth)) : 0;
}

function walkEvents(events: readonly SheetEvent[], onEvent: (event: SheetEvent) => void): void {
  for (const event of events) {
    onEvent(event);
    walkEvents(event.children, onEvent);
  }
}

/** The deepest research node any condition or action in this program requires. 0 for an
 * Inti-only sheet (the free starter set), up to `MAX_DEPTH` for one that reaches a capstone. */
export function virusDepthBand(program: VirusProgram): number {
  let max = 0;
  walkEvents(program.events, (event) => {
    for (const condition of event.conditions) {
      max = Math.max(max, conditionDepth(condition.kind));
    }
    for (const action of event.actions) {
      max = Math.max(max, actionDepth(action.kind, action.tier ?? 1));
    }
  });
  return Math.min(max, MAX_DEPTH);
}

/** The deepest research node any placed node (excluding structural `entry`/`core`, which are
 * never gated — PLAN.md 8.7) requires. */
export function defenseDepthBand(graph: DefenseGraph): number {
  let max = 0;
  for (const node of graph.nodes) {
    if (node.type === "entry" || node.type === "core") {
      continue;
    }
    max = Math.max(max, defenseNodeDepth(node.type, node.tier));
  }
  return Math.min(max, MAX_DEPTH);
}

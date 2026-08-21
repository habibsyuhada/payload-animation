import {
  ACTION_SPECS_V2,
  CONDITION_SPECS_V2,
  DEFENSE_NODE_TYPES_V2,
  getDefenseNodeCostV2,
  validateVirusProgram,
  RULESET_V2,
  type ActionKind,
  type BlockTier,
  type ConditionKind,
  type DefenseNodeType,
} from "@payload/sim";
import { describe, expect, it } from "vitest";
import { RESEARCH_TREE } from "../src/research-tree.js";
import type { ResearchNode, Unlock } from "../src/research.js";
import { canResearch, isActionUnlocked, isConditionUnlocked, isDefenseNodeUnlocked, unlockedSet } from "../src/unlocks.js";

/**
 * The research version of `sheetCatalog.ts`'s `CATALOG_COVERS_EVERY_KIND` (PLAN.md 8.6, ADR 0007
 * §C): "tidak ada simpul yatim" isn't a design aspiration, it is a test. A `ConditionKind`/
 * `ActionKind`/`(DefenseNodeType, tier)` pair the sim prices but the tree has nothing to say about
 * would only ever surface as a player finding a permanently-locked item with no research node that
 * unlocks it.
 */

const PLACEABLE_NODE_TYPES: readonly DefenseNodeType[] = DEFENSE_NODE_TYPES_V2.filter((type) => type !== "entry" && type !== "core");
const TIERS: readonly BlockTier[] = [1, 2, 3];

function allUnlocks(tree: readonly ResearchNode[]): Unlock[] {
  return tree.flatMap((node) => node.unlocks);
}

describe("RESEARCH_TREE structure", () => {
  it("has no duplicate node ids", () => {
    const ids = RESEARCH_TREE.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never requires an id that doesn't exist in the tree", () => {
    const ids = new Set(RESEARCH_TREE.map((node) => node.id));
    for (const node of RESEARCH_TREE) {
      for (const requiredId of node.requires) {
        expect(ids.has(requiredId)).toBe(true);
      }
    }
  });

  it("has no prerequisite cycles", () => {
    const byId = new Map(RESEARCH_TREE.map((node) => [node.id, node]));
    const visiting = new Set<string>();
    const done = new Set<string>();

    function visit(id: string, path: readonly string[]): void {
      if (done.has(id)) {
        return;
      }
      if (visiting.has(id)) {
        throw new Error(`cycle: ${[...path, id].join(" -> ")}`);
      }
      visiting.add(id);
      for (const requiredId of byId.get(id)!.requires) {
        visit(requiredId, [...path, id]);
      }
      visiting.delete(id);
      done.add(id);
    }

    expect(() => {
      for (const node of RESEARCH_TREE) {
        visit(node.id, []);
      }
    }).not.toThrow();
  });

  it("keeps every node's cost matching its own depth's stated price", () => {
    const COST_BY_DEPTH: Readonly<Record<number, number>> = { 0: 0, 1: 150, 2: 400, 3: 900, 4: 1800 };
    for (const node of RESEARCH_TREE) {
      expect(node.costData).toBe(COST_BY_DEPTH[node.depth]);
    }
  });

  it("gives every depth-0 node zero prerequisites and zero cost, and only depth-0 nodes are free", () => {
    for (const node of RESEARCH_TREE) {
      if (node.depth === 0) {
        expect(node.branch).toBe("inti");
        expect(node.requires).toEqual([]);
      }
      expect(node.costData === 0).toBe(node.depth === 0);
    }
  });
});

describe("RESEARCH_TREE completeness — no orphan kind", () => {
  it("unlocks every ConditionKind exactly once", () => {
    const conditionUnlocks = allUnlocks(RESEARCH_TREE).filter((unlock): unlock is Extract<Unlock, { kind: "condition" }> => unlock.kind === "condition");
    const counts = new Map<ConditionKind, number>();
    for (const unlock of conditionUnlocks) {
      counts.set(unlock.condition, (counts.get(unlock.condition) ?? 0) + 1);
    }
    for (const spec of CONDITION_SPECS_V2) {
      expect(counts.get(spec.kind)).toBe(1);
    }
    expect(counts.size).toBe(CONDITION_SPECS_V2.length);
  });

  it("gives every ActionKind exactly one base unlock (tier omitted)", () => {
    const actionUnlocks = allUnlocks(RESEARCH_TREE).filter((unlock): unlock is Extract<Unlock, { kind: "action" }> => unlock.kind === "action");
    const baseCounts = new Map<ActionKind, number>();
    for (const unlock of actionUnlocks) {
      if (unlock.tier === undefined) {
        baseCounts.set(unlock.action, (baseCounts.get(unlock.action) ?? 0) + 1);
      }
    }
    for (const spec of ACTION_SPECS_V2) {
      expect(baseCounts.get(spec.kind)).toBe(1);
    }
    expect(baseCounts.size).toBe(ACTION_SPECS_V2.length);
  });

  it("never unlocks a tier for an action twice, and only for actions that actually have tiers", () => {
    const actionUnlocks = allUnlocks(RESEARCH_TREE).filter((unlock): unlock is Extract<Unlock, { kind: "action" }> => unlock.kind === "action");
    const seen = new Set<string>();
    for (const unlock of actionUnlocks) {
      if (unlock.tier === undefined) {
        continue;
      }
      const key = `${unlock.action}.${unlock.tier}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(ACTION_SPECS_V2.find((spec) => spec.kind === unlock.action)?.weightKbByTier).toBeDefined();
    }
  });

  it("unlocks every placeable (DefenseNodeType, tier) pair exactly once", () => {
    const defenseUnlocks = allUnlocks(RESEARCH_TREE).filter((unlock): unlock is Extract<Unlock, { kind: "defense-node" }> => unlock.kind === "defense-node");
    const counts = new Map<string, number>();
    for (const unlock of defenseUnlocks) {
      const key = `${unlock.node}.${unlock.tier ?? "-"}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let expectedPairCount = 0;
    for (const type of PLACEABLE_NODE_TYPES) {
      let isTiered = false;
      for (const tier of TIERS) {
        try {
          getDefenseNodeCostV2(type, tier);
          isTiered = true;
          expectedPairCount += 1;
          expect(counts.get(`${type}.${tier}`)).toBe(1);
        } catch {
          // Not a valid tier for this type — fine, most types just don't go that high (they all do here, but router doesn't).
        }
      }
      if (!isTiered) {
        // Untiered placeable type (router): exactly one cost entry with no tier.
        expect(() => getDefenseNodeCostV2(type)).not.toThrow();
        expectedPairCount += 1;
        expect(counts.get(`${type}.-`)).toBe(1);
      }
    }
    expect(counts.size).toBe(expectedPairCount);
  });
});

describe("unlockedSet / canResearch", () => {
  it("reflects nothing unlocked from an empty completed list", () => {
    const unlocked = unlockedSet([], RESEARCH_TREE);
    expect(isConditionUnlocked(unlocked, "at-node")).toBe(false);
    expect(isActionUnlocked(unlocked, "move-toward-core")).toBe(false);
    expect(isDefenseNodeUnlocked(unlocked, "router")).toBe(false);
  });

  it("unlocks a kind, and raises its tier ceiling, only as the matching nodes complete", () => {
    const afterBase = unlockedSet(["serbuan.exploit.1"], RESEARCH_TREE);
    expect(isActionUnlocked(afterBase, "exploit", 1)).toBe(true);
    expect(isActionUnlocked(afterBase, "exploit", 2)).toBe(false);

    const afterTierTwo = unlockedSet(["serbuan.exploit.1", "serbuan.exploit.2"], RESEARCH_TREE);
    expect(isActionUnlocked(afterTierTwo, "exploit", 2)).toBe(true);
    expect(isActionUnlocked(afterTierTwo, "exploit", 3)).toBe(false);
  });

  it("gates canResearch on prerequisites, cost, and not-already-completed", () => {
    const exploitTwo = RESEARCH_TREE.find((node) => node.id === "serbuan.exploit.2")!;
    expect(canResearch(exploitTwo, { version: 1, data: 1000, completed: [], claimed: {} })).toBe(false); // missing prereq
    expect(canResearch(exploitTwo, { version: 1, data: 1000, completed: ["serbuan.exploit.1"], claimed: {} })).toBe(true);
    expect(canResearch(exploitTwo, { version: 1, data: 10, completed: ["serbuan.exploit.1"], claimed: {} })).toBe(false); // too little Data
    expect(canResearch(exploitTwo, { version: 1, data: 1000, completed: ["serbuan.exploit.1", "serbuan.exploit.2"], claimed: {} })).toBe(false); // already done
  });
});

describe("starter set (Inti, depth 0)", () => {
  it("unlocks enough on its own to write a legal tier-1 sheet", () => {
    const inti = RESEARCH_TREE.filter((node) => node.depth === 0).map((node) => node.id);
    const unlocked = unlockedSet(inti, RESEARCH_TREE);
    expect(isActionUnlocked(unlocked, "move-toward-core")).toBe(true);
    expect(isActionUnlocked(unlocked, "brute-force")).toBe(true);
    expect(isConditionUnlocked(unlocked, "on-breach-node")).toBe(true);

    const program = {
      events: [{ conditions: [], actions: [{ kind: "brute-force" as const, tier: 1 as const }, { kind: "move-toward-core" as const }], children: [] }],
    };
    const result = validateVirusProgram(program, RULESET_V2, 1);
    expect(result.valid).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { getTarpitConfigV2 } from "../../src/nodes-v2/tarpit.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInputV2, BattleLog, DefenseGraph, DefenseNode, SheetEvent } from "../../src/types.js";

describe("getTarpitConfigV2", () => {
  it("matches docs/RULESET.md §14", () => {
    expect(getTarpitConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, speedMultiplierPermille: 600 });
    expect(getTarpitConfigV2(2)).toEqual({ tier: 2, radiusHops: 1, speedMultiplierPermille: 500 });
    expect(getTarpitConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, speedMultiplierPermille: 400 });
  });

  it("slows more (lower ‰) at higher tier", () => {
    expect(getTarpitConfigV2(1).speedMultiplierPermille).toBeGreaterThan(getTarpitConfigV2(3).speedMultiplierPermille);
  });

  it("throws on an unknown tier rather than silently returning undefined", () => {
    expect(() => getTarpitConfigV2(4 as never)).toThrow(/no v2 tarpit config/);
  });
});

/** Entry 1/2 -> Router 3 -> Core 4 (900 DU, so the tick delta from a slowdown is easy to read),
 * with 0..N Tarpit nodes hanging off the Router at hop 1. */
function graphWithTarpits(tarpits: readonly DefenseNode[]): DefenseGraph {
  const nodes: DefenseNode[] = [{ id: 1, type: "entry" }, { id: 2, type: "entry" }, { id: 3, type: "router" }, { id: 4, type: "core" }, ...tarpits];
  const edges = [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 900 },
    ...tarpits.map((tarpit) => ({ from: 3, to: tarpit.id, lengthDu: 200 })),
  ];
  return { nodes, edges, entryNodeIds: [1, 2], coreNodeId: 4, coreHp: 100_000 };
}

const MOVE_TOWARD_CORE: SheetEvent[] = [{ conditions: [], actions: [{ kind: "move-toward-core" }], children: [] }];

function arrivalTickAtCore(tarpits: readonly DefenseNode[]): number {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events: MOVE_TOWARD_CORE }, defense: graphWithTarpits(tarpits) };
  const log: BattleLog = simulate(input);
  return log.events.find((event) => event.type === "virus-entered-node" && event.target === "4")!.tick;
}

describe("Tarpit — engine integration", () => {
  it("slows the virus while it's in range — arrival at Core is later with a Tarpit than without", () => {
    const baseline = arrivalTickAtCore([]);
    const slowed = arrivalTickAtCore([{ id: 5, type: "tarpit", tier: 1 }]);
    expect(slowed).toBeGreaterThan(baseline);
    // 900 DU: ceil(900/50)=18 ticks at base speed, ceil(900/30)=30 at 600‰ (floor(50*600/1000)=30) — delta 12.
    expect(slowed - baseline).toBe(12);
  });

  it("slows more at a higher tier (lower ‰ multiplier)", () => {
    const tierI = arrivalTickAtCore([{ id: 5, type: "tarpit", tier: 1 }]);
    const tierIII = arrivalTickAtCore([{ id: 5, type: "tarpit", tier: 3 }]);
    expect(tierIII).toBeGreaterThan(tierI);
  });

  it("does not stack — two overlapping Tarpits slow the virus no more than the stronger one alone", () => {
    const strongestAlone = arrivalTickAtCore([{ id: 5, type: "tarpit", tier: 3 }]);
    const both = arrivalTickAtCore([
      { id: 5, type: "tarpit", tier: 3 },
      { id: 6, type: "tarpit", tier: 1 },
    ]);
    expect(both).toBe(strongestAlone);
  });
});

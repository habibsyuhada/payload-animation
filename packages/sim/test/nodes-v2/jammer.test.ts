import { describe, expect, it } from "vitest";
import { getJammerConfigV2 } from "../../src/nodes-v2/jammer.js";
import { simulate } from "../../src/simulate.js";
import type { BattleInputV2, BattleLog, DefenseGraph, DefenseNode, SheetEvent } from "../../src/types.js";

describe("getJammerConfigV2", () => {
  it("matches docs/RULESET.md §14", () => {
    expect(getJammerConfigV2(1)).toEqual({ tier: 1, radiusHops: 1, jamsNodeAhead: false });
    expect(getJammerConfigV2(2)).toEqual({ tier: 2, radiusHops: 2, jamsNodeAhead: false });
    expect(getJammerConfigV2(3)).toEqual({ tier: 3, radiusHops: 2, jamsNodeAhead: true });
  });

  it("only tier III falsifies node-ahead-is", () => {
    expect(getJammerConfigV2(1).jamsNodeAhead).toBe(false);
    expect(getJammerConfigV2(2).jamsNodeAhead).toBe(false);
    expect(getJammerConfigV2(3).jamsNodeAhead).toBe(true);
  });

  it("throws on an unknown tier rather than silently returning undefined", () => {
    expect(() => getJammerConfigV2(4 as never)).toThrow(/no v2 jammer config/);
  });
});

/**
 * Entry 1/2 -> Router 3 -> Honeypot 4 -> Core 5 (short, 400 DU total) and Router 3 -> Core 5
 * directly (900 DU, the detour). A sheet with `[honeypot-near] -> move-avoiding-hazards` picks the
 * detour and survives; jam the sensor and it can't tell the honeypot is there, so it takes the
 * short route straight into it. `includeJammer` puts a Jammer at the Router too (hop 1 from both
 * the Router the virus stands on and the Honeypot it's sensing).
 */
function jammerGraph(includeJammer: boolean, jammerTier: 1 | 2 | 3 = 1): DefenseGraph {
  const nodes: DefenseNode[] = [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "honeypot", tier: 1 },
    { id: 5, type: "core" },
  ];
  const edges = [
    { from: 1, to: 3, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
    { from: 3, to: 4, lengthDu: 200 },
    { from: 4, to: 5, lengthDu: 200 },
    { from: 3, to: 5, lengthDu: 900 },
  ];
  if (includeJammer) {
    nodes.push({ id: 6, type: "jammer", tier: jammerTier });
    edges.push({ from: 3, to: 6, lengthDu: 200 });
  }
  return { nodes, edges, entryNodeIds: [1, 2], coreNodeId: 5, coreHp: 60 };
}

const AVOID_HONEYPOT_SHEET: SheetEvent[] = [
  { conditions: [{ kind: "honeypot-near" }], actions: [{ kind: "move-avoiding-hazards" }], children: [] },
  { conditions: [], actions: [{ kind: "move-toward-core" }], children: [] },
];

function run(defense: DefenseGraph, events: readonly SheetEvent[] = AVOID_HONEYPOT_SHEET): BattleLog {
  const input: BattleInputV2 = { rulesetVersion: "v2", seed: 1, virus: { events }, defense };
  return simulate(input);
}

describe("Jammer — engine integration", () => {
  it("without a Jammer, honeypot-near correctly senses the trap and the sheet routes around it", () => {
    const log = run(jammerGraph(false));
    expect(log.result.winner).toBe("attacker");
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.target === "4")).toBe(false);
  });

  it("with a Jammer in range, honeypot-near reads false and the same sheet walks straight into the trap it would have avoided", () => {
    const log = run(jammerGraph(true));
    expect(log.result.winner).toBe("defender");
    expect(log.events.some((event) => event.type === "virus-entered-node" && event.target === "4")).toBe(true);
  });

  it("tier III also falsifies node-ahead-is — a sheet that holds position when a Honeypot is directly ahead walks in anyway when jammed", () => {
    const holdIfHoneypotAhead: SheetEvent[] = [
      { conditions: [{ kind: "node-ahead-is", targetNodeTypes: ["honeypot"] }], actions: [{ kind: "hold-position" }], children: [] },
      { conditions: [], actions: [{ kind: "move-toward-core" }], children: [] },
    ];
    // Force the virus onto the short leg by removing the long detour, so node-ahead-is is what's under test.
    const graph = jammerGraph(true, 3);
    const directGraph: DefenseGraph = { ...graph, edges: graph.edges.filter((edge) => !(edge.from === 3 && edge.to === 5)) };

    const unjammed = run({ ...directGraph, nodes: directGraph.nodes.filter((node) => node.type !== "jammer") }, holdIfHoneypotAhead);
    expect(unjammed.events.some((event) => event.type === "virus-entered-node" && event.target === "4")).toBe(false);

    const jammed = run(directGraph, holdIfHoneypotAhead);
    expect(jammed.events.some((event) => event.type === "virus-entered-node" && event.target === "4")).toBe(true);
  });
});

import { simulate } from "@payload/sim";
import type { BattleInput, DefenseGraph, DefenseNode } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { compileTimeline, findTrack, rulesFiringAt, sampleCoreHp, sampleIntegrity, samplePosition, type Layout } from "../src/compile.js";

// entry(1)/(2) --400du--> router(3) --600du--> core(4), speed 50: arrives router tick 8,
// departs tick 9, arrives core tick 21 (matches packages/sim's engine.test.ts Scenario 1).
const GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 400 },
    { from: 2, to: 3, lengthDu: 400 },
    { from: 3, to: 4, lengthDu: 600 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 100,
};
const INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: GRAPH };

const LAYOUT: Layout = {
  positions: {
    1: { x: 0, y: 0 },
    2: { x: 0, y: 100 },
    3: { x: 200, y: 50 },
    4: { x: 500, y: 50 },
  },
};

describe("compileTimeline", () => {
  it("builds a position keyframe for every entered/departed event, in tick order", () => {
    const log = simulate(INPUT);
    const timeline = compileTimeline(log, LAYOUT);
    const virus = findTrack(timeline, "virus")!;
    // entry-enter(0), entry-depart(0, same tick per ADR 0001), router-arrive(8),
    // router-depart(9), core-arrive(21).
    expect(virus.position.map((keyframe) => keyframe.t)).toEqual([0, 0, 0.4, 0.45, 1.05]);
  });

  it("durationSeconds matches the log's final event tick, in seconds", () => {
    const log = simulate(INPUT);
    const timeline = compileTimeline(log, LAYOUT);
    const lastTick = log.events[log.events.length - 1]!.tick;
    expect(timeline.durationSeconds).toBeCloseTo(lastTick * 0.05, 10);
  });

  it("throws if the layout is missing a position for a node the virus visits", () => {
    const log = simulate(INPUT);
    const incompleteLayout: Layout = { positions: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 100 } } };
    expect(() => compileTimeline(log, incompleteLayout)).toThrow();
  });

  it("includes a marker for the final battle-won event", () => {
    const log = simulate(INPUT);
    const timeline = compileTimeline(log, LAYOUT);
    expect(timeline.markers).toContainEqual(expect.objectContaining({ kind: "won" }));
  });

  it("carries a static node entry (with layout position) for every defense node", () => {
    const log = simulate(INPUT);
    const timeline = compileTimeline(log, LAYOUT);
    expect(timeline.nodes).toHaveLength(GRAPH.nodes.length);
    expect(timeline.nodes).toContainEqual({ id: 3, type: "router", position: LAYOUT.positions[3] });
    expect(timeline.nodes).toContainEqual({ id: 4, type: "core", position: LAYOUT.positions[4] });
  });

  it("resolves a damage marker's nodeId to its source node (the firewall, not 'virus')", () => {
    const firewallGraph: DefenseGraph = { ...GRAPH, nodes: GRAPH.nodes.map((node) => (node.id === 3 ? { ...node, type: "firewall" as const, tier: 1 as const } : node)) };
    const log = simulate({ ...INPUT, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: firewallGraph });
    const timeline = compileTimeline(log, LAYOUT);
    const damageMarkers = timeline.markers.filter((marker) => marker.kind === "damage");
    expect(damageMarkers.length).toBeGreaterThan(0);
    expect(damageMarkers.every((marker) => marker.nodeId === 3)).toBe(true);
  });
});

/** V7.5: a ruleset v2 battle over the same graph, so the rule track has something to carry. */
const SHEET_INPUT: BattleInput = {
  rulesetVersion: "v2",
  seed: 1,
  virus: {
    events: [
      { id: "attack", conditions: [{ kind: "node-here-is", targetNodeTypes: ["core"] }], actions: [{ kind: "brute-force", tier: 1 }], children: [] },
      { conditions: [], actions: [{ kind: "move-toward-core" }], children: [] },
    ],
  },
  defense: GRAPH,
};

describe("compileTimeline — rule firings (ruleset v2)", () => {
  it("carries one entry per rule-fired event, named by the sheet's own id where it has one", () => {
    const timeline = compileTimeline(simulate(SHEET_INPUT), LAYOUT);
    expect(timeline.ruleFirings.length).toBeGreaterThan(0);
    expect(new Set(timeline.ruleFirings.map((firing) => firing.ruleId))).toEqual(new Set(["attack", "1"]));
    // Firings are in tick order, converted to seconds like every other track.
    const times = timeline.ruleFirings.map((firing) => firing.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("stays empty for a v1 log — that engine has no rules to fire", () => {
    expect(compileTimeline(simulate(INPUT), LAYOUT).ruleFirings).toEqual([]);
  });

  it("reports a rule as firing for a window after its tick, not just on the exact frame", () => {
    const timeline = compileTimeline(simulate(SHEET_INPUT), LAYOUT);
    // The gated rule, which only starts firing once the virus is standing on the Core.
    const first = timeline.ruleFirings.find((firing) => firing.ruleId === "attack")!;
    expect(first.t).toBeGreaterThan(0.5);
    expect(rulesFiringAt(timeline, first.t, 0.3).has("attack")).toBe(true);
    expect(rulesFiringAt(timeline, first.t + 0.2, 0.3).has("attack")).toBe(true);
    // Before it ever fired, it is dark.
    expect(rulesFiringAt(timeline, first.t - 0.3, 0.3).has("attack")).toBe(false);
  });
});

describe("samplePosition", () => {
  const log = simulate(INPUT);
  const timeline = compileTimeline(log, LAYOUT);
  const virus = findTrack(timeline, "virus")!;
  const fallback = { x: -1, y: -1 };
  // seed=1 picks its entry via RNG (packages/sim §0) — read back which one from the log itself
  // rather than assuming, since that choice isn't something replay should predict independently.
  const entryNodeId = Number(log.events[0]!.target);

  it("holds the entry position before the virus starts moving", () => {
    expect(samplePosition(virus, 0, fallback)).toEqual(LAYOUT.positions[entryNodeId]);
  });

  it("holds still at the router while dwelling (between arrival and departure)", () => {
    expect(samplePosition(virus, 0.42, fallback)).toEqual(LAYOUT.positions[3]);
  });

  it("interpolates smoothly between router and core while in transit", () => {
    const midTransit = samplePosition(virus, 0.75, fallback); // halfway between t=0.45 and t=1.05
    expect(midTransit.x).toBeGreaterThan(LAYOUT.positions[3]!.x);
    expect(midTransit.x).toBeLessThan(LAYOUT.positions[4]!.x);
  });

  it("holds the final position past the end of the battle", () => {
    expect(samplePosition(virus, 999, fallback)).toEqual(LAYOUT.positions[4]);
  });

  it("is scrub-safe: sampling out of order (forward, then back to an earlier T) is identical to sampling in order", () => {
    const forwardOrder = [0, 0.2, 0.4, 0.42, 0.45, 0.6, 0.75, 0.9, 1.05];
    const forwardResults = forwardOrder.map((t) => samplePosition(virus, t, fallback));

    // scrub forward to the end, then back through the same points in reverse.
    const scrubbedResults: typeof forwardResults = [];
    for (const t of forwardOrder) {
      samplePosition(virus, t, fallback); // simulate "playing forward" past this point
    }
    for (const t of [...forwardOrder].reverse()) {
      scrubbedResults.unshift(samplePosition(virus, t, fallback));
    }

    expect(scrubbedResults).toEqual(forwardResults);
  });

  it("compiles the virus's health as a track that starts full and only moves when the log says so", () => {
    // A firewall the virus has to breach, so there is real damage in the log to compile from.
    const guarded: DefenseGraph = {
      ...GRAPH,
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
    };
    const timeline = compileTimeline(simulate({ ...INPUT, defense: guarded }), LAYOUT);

    expect(sampleIntegrity(timeline, 0)).toBe(1);
    const damaged = timeline.markers.find((marker) => marker.kind === "damage");
    expect(damaged).toBeDefined();
    // Health is a step function: unchanged right up to the hit, lower right after it.
    expect(sampleIntegrity(timeline, damaged!.t - 0.001)).toBeGreaterThan(sampleIntegrity(timeline, damaged!.t));
    expect(sampleIntegrity(timeline, timeline.durationSeconds)).toBeLessThanOrEqual(1);
  });

  it("carries the damage amount on the marker, so a renderer never has to parse it out of the label", () => {
    const guarded: DefenseGraph = {
      ...GRAPH,
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
    };
    const timeline = compileTimeline(simulate({ ...INPUT, defense: guarded }), LAYOUT);
    const damaged = timeline.markers.find((marker) => marker.kind === "damage" && marker.nodeId === 3);
    expect(damaged?.amount).toBeGreaterThan(0);
    // The label leads with the actor's node id — reading the number out of it would report 3.
    expect(damaged!.label.startsWith("3 ")).toBe(true);
    expect(damaged!.amount).not.toBe(3);
  });

  it("compiles the Core's health from the damage aimed at it, scaled by the coreHp the log itself carries", () => {
    const timeline = compileTimeline(simulate(INPUT), LAYOUT);

    expect(sampleCoreHp(timeline, 0)).toBe(1);
    const drains = timeline.markers.filter((marker) => marker.kind === "node-hit" && marker.nodeId === 4);
    expect(drains.length).toBeGreaterThan(0);
    // Steps down at the first drain and keeps going; the battle is won when it reaches zero.
    expect(sampleCoreHp(timeline, drains[0]!.t - 0.001)).toBe(1);
    expect(sampleCoreHp(timeline, drains[0]!.t)).toBeLessThan(1);
    expect(sampleCoreHp(timeline, timeline.durationSeconds)).toBe(0);
  });

  it("keeps damage dealt TO a node separate from damage taken BY the virus", () => {
    const guarded: DefenseGraph = {
      ...GRAPH,
      nodes: [
        { id: 1, type: "entry" },
        { id: 2, type: "entry" },
        { id: 3, type: "firewall", tier: 1 },
        { id: 4, type: "core" },
      ] satisfies DefenseNode[],
    };
    const timeline = compileTimeline(simulate({ ...INPUT, defense: guarded }), LAYOUT);

    // The firewall both deals damage to the virus and takes it — one node, two opposite stories.
    expect(timeline.markers.some((marker) => marker.kind === "damage" && marker.nodeId === 3)).toBe(true);
    expect(timeline.markers.some((marker) => marker.kind === "node-hit" && marker.nodeId === 3)).toBe(true);
    // Core damage is never reported as the virus being hurt.
    expect(timeline.markers.some((marker) => marker.kind === "damage" && marker.nodeId === 4)).toBe(false);
  });
});

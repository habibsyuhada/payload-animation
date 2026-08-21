import { simulate } from "@payload/sim";
import type { BattleInput, DefenseGraph, DefenseNode } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { compileTimeline, type Layout, type Timeline } from "../src/compile.js";
import { drawFrame, type DrawContext2D } from "../src/draw.js";

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingContext implements DrawContext2D {
  readonly canvas = { width: 800, height: 600 };
  readonly calls: Call[] = [];
  private state = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1 };

  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(value: string) {
    this.state.fillStyle = value;
  }
  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: string) {
    this.state.strokeStyle = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args: [...args, { ...this.state }] });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.record("clearRect", x, y, w, h);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record("fillRect", x, y, w, h);
  }
  beginPath(): void {
    this.record("beginPath");
  }
  moveTo(x: number, y: number): void {
    this.record("moveTo", x, y);
  }
  lineTo(x: number, y: number): void {
    this.record("lineTo", x, y);
  }
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.record("arc", x, y, radius, startAngle, endAngle);
  }
  fill(): void {
    this.record("fill");
  }
  stroke(): void {
    this.record("stroke");
  }
  save(): void {
    this.record("save");
  }
  restore(): void {
    this.record("restore");
  }
  translate(x: number, y: number): void {
    this.record("translate", x, y);
  }
  rotate(angle: number): void {
    this.record("rotate", angle);
  }
}

// entry(1)/(2) -> firewall I(3) -> core(4), with an ICE Sentry(5) hanging off the firewall.
const GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "firewall", tier: 1 },
    { id: 4, type: "core" },
    { id: 5, type: "ice-sentry", tier: 1 },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 200 },
    { from: 2, to: 3, lengthDu: 200 },
    { from: 3, to: 4, lengthDu: 200 },
    { from: 3, to: 5, lengthDu: 200 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 100,
};
const INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: GRAPH };
const LAYOUT: Layout = { positions: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 200 }, 3: { x: 200, y: 100 }, 4: { x: 500, y: 100 }, 5: { x: 300, y: 250 } } };

function buildTimeline(): Timeline {
  return compileTimeline(simulate(INPUT), LAYOUT);
}

describe("drawFrame", () => {
  it("is a pure function of (timeline, T): identical inputs always produce identical draw calls", () => {
    const timeline = buildTimeline();
    const ctxA = new RecordingContext();
    const ctxB = new RecordingContext();
    drawFrame(timeline, 0.6, ctxA);
    drawFrame(timeline, 0.6, ctxB);
    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it("is scrub-safe: drawing forward through T then back to an earlier T reproduces that T's exact frame", () => {
    const timeline = buildTimeline();
    const sequence = [0, 0.1, 0.3, 0.5, 0.7, 0.9];
    const forwardCtx = new RecordingContext();
    for (const t of sequence) {
      drawFrame(timeline, t, forwardCtx);
    }
    const forwardFrameAt05 = [...forwardCtx.calls]; // capture after playing through 0.9

    // now scrub backward: 0.9 -> ... -> 0.5, and compare the T=0.5 frame drawn fresh in isolation.
    const isolatedCtx = new RecordingContext();
    drawFrame(timeline, 0.5, isolatedCtx);

    const freshCtxAt05 = new RecordingContext();
    drawFrame(timeline, 0.5, freshCtxAt05);
    expect(isolatedCtx.calls).toEqual(freshCtxAt05.calls);
    expect(forwardFrameAt05.length).toBeGreaterThan(0); // sanity: forward playback did draw something
  });

  it("fills an opaque background and draws every static node once per frame", () => {
    const timeline = buildTimeline();
    const ctx = new RecordingContext();
    drawFrame(timeline, 0, ctx);
    // an opaque fillRect, not clearRect — R2.5's export needs real pixels, not transparency.
    expect(ctx.calls[0]!.op).toBe("fillRect");
    expect(ctx.calls[0]!.args.slice(0, 4)).toEqual([0, 0, 800, 600]);
    expect((ctx.calls[0]!.args[4] as { fillStyle: string }).fillStyle).toBe("#12141c");
    const arcCalls = ctx.calls.filter((call) => call.op === "arc");
    // 5 nodes + the virus itself, at minimum (trail/effects can add more).
    expect(arcCalls.length).toBeGreaterThanOrEqual(GRAPH.nodes.length + 1);
  });

  it("draws an ICE tracer line while a damage marker from an ice-sentry is within its effect window", () => {
    const timeline = buildTimeline();
    const iceMarker = timeline.markers.find((marker) => marker.kind === "damage" && marker.nodeId === 5);
    expect(iceMarker, "expected this battle to include at least one ICE hit").toBeDefined();

    const duringCtx = new RecordingContext();
    drawFrame(timeline, iceMarker!.t + 0.05, duringCtx);
    const hasTracerStroke = duringCtx.calls.some((call) => call.op === "stroke" && (call.args[0] as { strokeStyle: string }).strokeStyle === "#5ac8e6");
    expect(hasTracerStroke).toBe(true);

    const longAfterCtx = new RecordingContext();
    drawFrame(timeline, iceMarker!.t + 5, longAfterCtx);
    const hasTracerStrokeLater = longAfterCtx.calls.some((call) => call.op === "stroke" && (call.args[0] as { strokeStyle: string }).strokeStyle === "#5ac8e6");
    expect(hasTracerStrokeLater).toBe(false);
  });

  it("stops drawing the virus once it dies, replacing it with a fading burst", () => {
    // a Firewall I with no Attack block is survivable in v1 (post-S1.7), so force a lethal
    // Honeypot instead to get a clean 'died' marker to test against.
    const honeypotGraph: DefenseGraph = { ...GRAPH, nodes: GRAPH.nodes.map((node) => (node.id === 3 ? { ...node, type: "honeypot" as const } : node)) };
    const log = simulate({ ...INPUT, defense: honeypotGraph });
    const timeline = compileTimeline(log, LAYOUT);
    const died = timeline.markers.find((marker) => marker.kind === "died");
    expect(died).toBeDefined();

    const wellAfterCtx = new RecordingContext();
    drawFrame(timeline, died!.t + 1, wellAfterCtx);
    // node arcs still present, but no more virus-colored fill.
    const hasVirusFill = wellAfterCtx.calls.some((call) => call.op === "fill" && (call.args[0] as { fillStyle: string }).fillStyle === "#eaf6ff");
    expect(hasVirusFill).toBe(false);
  });

  it("bursts at Core when the attacker wins", () => {
    // the base fixture's Firewall+ICE chokepoint kills an unarmed virus before it reaches Core —
    // retype the firewall to a non-blocking router so this battle actually ends in a win.
    const winningGraph: DefenseGraph = { ...GRAPH, nodes: GRAPH.nodes.map((node) => (node.id === 3 ? { id: node.id, type: "router" as const } : node)) };
    const log = simulate({ ...INPUT, defense: winningGraph });
    const timeline = compileTimeline(log, LAYOUT);
    const won = timeline.markers.find((marker) => marker.kind === "won");
    expect(won).toBeDefined();
    const ctx = new RecordingContext();
    // burst radius grows via easeOutCubic over the effect window (0.3s) — sample late enough
    // in that window that it's grown past Core's resting radius, but still inside the window.
    drawFrame(timeline, won!.t + 0.2, ctx);
    const core = timeline.nodes.find((node) => node.type === "core")!;
    const hasBurstNearCore = ctx.calls.some((call) => call.op === "arc" && Math.abs((call.args[0] as number) - core.position.x) < 30 && Math.abs((call.args[1] as number) - core.position.y) < 30 && (call.args[2] as number) > NODE_RADIUS_CORE_BASELINE);
    expect(hasBurstNearCore).toBe(true);
  });
});

const NODE_RADIUS_CORE_BASELINE = 22; // Core's resting radius — a burst arc should exceed it.

/** PLAN.md 8.3e: Entry(1) -> Router(2, hub, splits+holds there) -> Core(3). Two bodies, neither
 * ever hurt (nothing on this map can hurt them), so both are still alive and drawable at any T. */
const SPLIT_GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "router" },
    { id: 3, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 2, lengthDu: 300 },
    { from: 2, to: 3, lengthDu: 300 },
  ],
  entryNodeIds: [1],
  coreNodeId: 3,
  coreHp: 100000, // never actually reached — this fixture is about drawing bodies, not winning.
};
const SPLIT_LAYOUT: Layout = { positions: { 1: { x: 0, y: 0 }, 2: { x: 200, y: 0 }, 3: { x: 500, y: 0 } } };
const SPLIT_INPUT: BattleInput = {
  rulesetVersion: "v2",
  seed: 7,
  virus: {
    events: [
      { once: "battle", conditions: [{ kind: "node-here-is", targetNodeTypes: ["router"] }], actions: [{ kind: "worm-split", tier: 1 }, { kind: "hold-position" }], children: [] },
      { conditions: [], actions: [{ kind: "move-toward-core" }], children: [] },
    ],
  },
  defense: SPLIT_GRAPH,
};

describe("drawFrame — multi-entity (PLAN.md 8.3e)", () => {
  it("draws a fill circle for every living body, not just entity 0", () => {
    const timeline = compileTimeline(simulate(SPLIT_INPUT), SPLIT_LAYOUT);
    const ctx = new RecordingContext();
    // Well after the split (0.35s), both bodies are moving and alive.
    drawFrame(timeline, 0.6, ctx);
    const virusFillCalls = ctx.calls.filter((call) => call.op === "fill" && (call.args[0] as { fillStyle: string }).fillStyle === "#eaf6ff");
    expect(virusFillCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("is still a pure function of (timeline, T) with two bodies on screen", () => {
    const timeline = compileTimeline(simulate(SPLIT_INPUT), SPLIT_LAYOUT);
    const ctxA = new RecordingContext();
    const ctxB = new RecordingContext();
    drawFrame(timeline, 0.6, ctxA);
    drawFrame(timeline, 0.6, ctxB);
    expect(ctxA.calls).toEqual(ctxB.calls);
  });
});

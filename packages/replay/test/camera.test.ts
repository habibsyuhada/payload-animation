import { simulate } from "@payload/sim";
import type { BattleInput, DefenseGraph, DefenseNode } from "@payload/sim";
import { describe, expect, it } from "vitest";
import { battleTimeAt, computeCameraCues, deathMoment, overviewShot, playbackDuration, sampleCameraShot } from "../src/camera.js";
import { compileTimeline, findNode, type Layout } from "../src/compile.js";

// entry(1)/(2) -> router(3) -> core(4), speed 50 — a long, uneventful trip (well over the 2.5s
// climax lookback) so there's real room for a "follow" cue before the finish.
const WIN_GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 2, type: "entry" },
    { id: 3, type: "router" },
    { id: 4, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 4000 },
    { from: 2, to: 3, lengthDu: 4000 },
    { from: 3, to: 4, lengthDu: 4000 },
  ],
  entryNodeIds: [1, 2],
  coreNodeId: 4,
  coreHp: 100,
};
const WIN_LAYOUT: Layout = { positions: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 100 }, 3: { x: 200, y: 50 }, 4: { x: 500, y: 50 } } };
const WIN_INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: WIN_GRAPH };

function winTimeline() {
  return compileTimeline(simulate(WIN_INPUT), WIN_LAYOUT);
}

// entry(1) -> honeypot(3) directly next to the entry: the virus dies almost immediately, so the
// climax lookback swallows the whole battle and there's no room left for a "follow" cue.
const SHORT_GRAPH: DefenseGraph = {
  nodes: [
    { id: 1, type: "entry" },
    { id: 3, type: "honeypot", tier: 1 },
    { id: 4, type: "core" },
  ] satisfies DefenseNode[],
  edges: [
    { from: 1, to: 3, lengthDu: 50 },
    { from: 3, to: 4, lengthDu: 400 },
  ],
  entryNodeIds: [1],
  coreNodeId: 4,
  coreHp: 100,
};
const SHORT_LAYOUT: Layout = { positions: { 1: { x: 0, y: 0 }, 3: { x: 100, y: 0 }, 4: { x: 500, y: 0 } } };
const SHORT_INPUT: BattleInput = { rulesetVersion: "v1", seed: 1, virus: { movement: { kind: "shortest-path" }, blocks: [] }, defense: SHORT_GRAPH };

function shortTimeline() {
  return compileTimeline(simulate(SHORT_INPUT), SHORT_LAYOUT);
}

describe("computeCameraCues", () => {
  it("produces intro -> follow -> climax -> outro for a battle with room before its finish", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    expect(cues.map((cue) => cue.kind)).toEqual(["intro", "follow", "climax", "outro"]);
  });

  it("chains cues back-to-back in playback time, starting at 0", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    expect(cues[0]!.playbackStart).toBe(0);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]!.playbackStart).toBeCloseTo(cues[i - 1]!.playbackEnd, 10);
    }
  });

  it("covers the full battle in battle-time, from 0 to durationSeconds, with no gaps between follow and climax", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const follow = cues.find((cue) => cue.kind === "follow")!;
    const climax = cues.find((cue) => cue.kind === "climax")!;
    expect(follow.battleStart).toBe(0);
    expect(climax.battleStart).toBeCloseTo(follow.battleEnd, 10);
    expect(climax.battleEnd).toBeCloseTo(timeline.durationSeconds, 10);
  });

  it("stretches the climax cue's playback span beyond its battle-time span (slow-mo)", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const climax = cues.find((cue) => cue.kind === "climax")!;
    const battleSpan = climax.battleEnd - climax.battleStart;
    const playbackSpan = climax.playbackEnd - climax.playbackStart;
    expect(playbackSpan).toBeGreaterThan(battleSpan);
  });

  it("omits the follow cue entirely when the climax lookback swallows the whole battle", () => {
    const timeline = shortTimeline();
    const cues = computeCameraCues(timeline);
    expect(cues.map((cue) => cue.kind)).toEqual(["intro", "climax", "outro"]);
    const climax = cues.find((cue) => cue.kind === "climax")!;
    expect(climax.battleStart).toBe(0);
  });
});

describe("battleTimeAt", () => {
  it("maps playback 0 to battle time 0, and the end of playback to the battle's own end", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    expect(battleTimeAt(cues, 0)).toBe(0);
    expect(battleTimeAt(cues, playbackDuration(cues))).toBeCloseTo(timeline.durationSeconds, 10);
  });

  it("is monotonically non-decreasing across the whole playback span", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const samples = Array.from({ length: 40 }, (_, i) => (i / 39) * playbackDuration(cues));
    let previous = -1;
    for (const t of samples) {
      const battleT = battleTimeAt(cues, t);
      expect(battleT).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = battleT;
    }
  });

  it("holds at the final battle time throughout the outro", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const outro = cues.find((cue) => cue.kind === "outro")!;
    expect(battleTimeAt(cues, outro.playbackStart)).toBeCloseTo(timeline.durationSeconds, 10);
    expect(battleTimeAt(cues, outro.playbackEnd)).toBeCloseTo(timeline.durationSeconds, 10);
  });
});

describe("sampleCameraShot", () => {
  it("frames the whole network during intro and outro", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const overview = overviewShot(timeline);
    const intro = sampleCameraShot(timeline, cues, 0.5);
    const outro = sampleCameraShot(timeline, cues, playbackDuration(cues) - 0.1);
    expect(intro).toEqual(overview);
    expect(outro).toEqual(overview);
  });

  it("tracks the virus's own position during the follow cue", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const follow = cues.find((cue) => cue.kind === "follow")!;
    const midPlayback = (follow.playbackStart + follow.playbackEnd) / 2;
    const shot = sampleCameraShot(timeline, cues, midPlayback);
    const battleT = battleTimeAt(cues, midPlayback);
    expect(shot.target.x).toBeGreaterThan(0);
    expect(battleT).toBeGreaterThan(follow.battleStart);
    expect(battleT).toBeLessThan(follow.battleEnd);
  });

  it("zooms in on the Core during the climax of a battle the attacker wins", () => {
    const timeline = winTimeline();
    const cues = computeCameraCues(timeline);
    const climax = cues.find((cue) => cue.kind === "climax")!;
    const shot = sampleCameraShot(timeline, cues, (climax.playbackStart + climax.playbackEnd) / 2);
    const core = findNode(timeline, timeline.nodes.find((node) => node.type === "core")!.id)!;
    expect(shot.target).toEqual(core.position);
    expect(shot.zoom).toBeGreaterThan(1);
  });
});

describe("deathMoment", () => {
  it("ends exactly at the terminal event and starts up to 5 battle-seconds earlier, clamped to 0", () => {
    const timeline = winTimeline();
    const moment = deathMoment(timeline)!;
    expect(moment).toBeDefined();
    expect(moment.battleEnd).toBeCloseTo(timeline.durationSeconds, 10);
    expect(moment.battleStart).toBeGreaterThanOrEqual(0);
    expect(moment.battleEnd - moment.battleStart).toBeLessThanOrEqual(5);
  });

  it("is independent of the auto intro/follow/climax/outro sequence (no cues required)", () => {
    const timeline = shortTimeline();
    const moment = deathMoment(timeline)!;
    expect(moment.battleStart).toBe(0); // the whole short battle fits inside the 5s lookback
  });
});

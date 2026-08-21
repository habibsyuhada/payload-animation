import { describe, expect, it } from "vitest";
import type { Timeline } from "@payload/replay";
import { frameAt } from "../src/logic/attackPlayback.js";

/**
 * attackPlayback.test.ts — PLAN.md 8.3e: `frameAt`'s multi-entity wiring (`viruses[]`, per-entity
 * `recentHits`, shots routed to whichever body they hit). Built from a hand-authored Timeline
 * rather than a real simulated battle: `frameAt` is a pure function of (timeline, t), and the
 * point here is testing ITS OWN logic in isolation, not re-proving `simulate()`/`compileTimeline`
 * (already covered in packages/sim and packages/replay's own test suites).
 */

const TWO_BODY_TIMELINE: Timeline = {
  durationSeconds: 1,
  nodes: [
    { id: 1, type: "ice-sentry", tier: 1, position: { x: 0, y: 0 } },
    { id: 2, type: "core", position: { x: 100, y: 0 } },
  ],
  edges: [],
  tracks: [
    { id: "virus", position: [{ t: 0, value: { x: 10, y: 0 } }], opacity: [] },
    { id: "virus:1", position: [{ t: 0, value: { x: 20, y: 0 } }], opacity: [] },
  ],
  markers: [
    { t: 0.1, kind: "damage", label: "1 deals 50 damage", nodeId: 1, amount: 50, entityId: 0 },
    { t: 0.1, kind: "damage", label: "1 deals 30 damage", nodeId: 1, amount: 30, entityId: 1 },
  ],
  virusIntegrity: [
    { t: 0, value: 1 },
    { t: 0.1, value: 0.95 },
  ],
  virusIntegrityByEntity: new Map([
    [
      0,
      [
        { t: 0, value: 1 },
        { t: 0.1, value: 0.95 },
      ],
    ],
    [
      1,
      [
        { t: 0, value: 1 },
        { t: 0.1, value: 0.97 },
      ],
    ],
  ]),
  coreHp: [{ t: 0, value: 1 }],
  ruleFirings: [],
};

describe("frameAt — multi-entity (8.3e)", () => {
  it("reports every body in viruses[], entity 0 included", () => {
    const frame = frameAt(TWO_BODY_TIMELINE, 0.15);
    expect(frame.viruses).toHaveLength(2);
    expect(frame.viruses.map((virus) => virus.entityId)).toEqual([0, 1]);
    expect(frame.viruses[0]!.position).toEqual({ x: 10, y: 0 });
    expect(frame.viruses[1]!.position).toEqual({ x: 20, y: 0 });
  });

  it("keeps virusPosition/integrity/virusAlive as entity 0's own values, for callers written before worm-split existed", () => {
    const frame = frameAt(TWO_BODY_TIMELINE, 0.15);
    expect(frame.virusPosition).toEqual({ x: 10, y: 0 });
    expect(frame.integrity).toBeCloseTo(0.95, 5);
    expect(frame.virusAlive).toBe(true);
  });

  it("routes each ICE Sentry shot to the body it actually hit, not always entity 0", () => {
    const frame = frameAt(TWO_BODY_TIMELINE, 0.15);
    expect(frame.shots).toHaveLength(2);
    const shotAtEntity0 = frame.shots.find((shot) => shot.damage === 50)!;
    const shotAtEntity1 = frame.shots.find((shot) => shot.damage === 30)!;
    expect(shotAtEntity0.to).toEqual({ x: 10, y: 0 });
    expect(shotAtEntity1.to).toEqual({ x: 20, y: 0 });
  });

  it("keeps recentHits keyed per body, so two bodies hit in the same window don't collapse into one floating number", () => {
    const frame = frameAt(TWO_BODY_TIMELINE, 0.15);
    expect(frame.recentHits).toHaveLength(2);
    const hitForEntity0 = frame.recentHits.find((hit) => hit.entityId === 0)!;
    const hitForEntity1 = frame.recentHits.find((hit) => hit.entityId === 1)!;
    expect(hitForEntity0.damage).toBe(50);
    expect(hitForEntity1.damage).toBe(30);
  });

  it("marks a body dead once its Integrity track reaches 0, independently of the other", () => {
    const deadEntity1: Timeline = {
      ...TWO_BODY_TIMELINE,
      virusIntegrityByEntity: new Map([
        [0, TWO_BODY_TIMELINE.virusIntegrityByEntity.get(0)!],
        [
          1,
          [
            { t: 0, value: 1 },
            { t: 0.1, value: 0 },
          ],
        ],
      ]),
    };
    const frame = frameAt(deadEntity1, 0.15);
    const entity0 = frame.viruses.find((virus) => virus.entityId === 0)!;
    const entity1 = frame.viruses.find((virus) => virus.entityId === 1)!;
    expect(entity0.alive).toBe(true);
    expect(entity1.alive).toBe(false);
    // Entity 0's own alias is unaffected by entity 1 dying.
    expect(frame.virusAlive).toBe(true);
  });
});

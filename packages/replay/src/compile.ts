import type { BattleEvent, BattleEventType, BattleLog } from "@payload/sim";
import { type EasingFn, linear, mix, mixVec2, type Vec2 } from "./ease.js";

/**
 * BattleLog -> Timeline compiler (PLAN.md §2 contract: `compileTimeline(log, layout): Timeline`).
 * Reads ONLY the log's event data — packages/replay must never recompute gameplay math (pathing,
 * damage, RNG); see the commit that added `virus-departed-node` to the sim event vocabulary
 * specifically so this compiler wouldn't need to.
 */

/** 1 tick = 50ms (docs/RULESET.md §0). Replay owns this conversion as a rendering concern — it
 * mirrors, but deliberately doesn't import, sim's TICK_MS constant (packages/replay may only
 * import sim's *types*, not its runtime values, so it never becomes a second interpreter of
 * gameplay rules). */
const TICK_SECONDS = 0.05;

export type { Vec2 };

export interface Keyframe<T> {
  readonly t: number;
  readonly value: T;
  /** Eases the transition INTO this keyframe from the previous one. Defaults to linear. */
  readonly easing?: EasingFn;
}

export interface EntityTrack {
  readonly id: string;
  readonly position: readonly Keyframe<Vec2>[];
  readonly opacity: readonly Keyframe<number>[];
}

export type TimelineMarkerKind = "damage" | "destroyed" | "died" | "won" | "timeout" | "status";

export interface TimelineMarker {
  readonly t: number;
  readonly kind: TimelineMarkerKind;
  readonly label: string;
}

export interface Timeline {
  readonly durationSeconds: number;
  readonly tracks: readonly EntityTrack[];
  readonly markers: readonly TimelineMarker[];
}

/** Node id -> screen position. Layout is provided by the caller (e.g. Defense Grid's saved node positions) — compileTimeline never invents one. */
export interface Layout {
  readonly positions: Readonly<Record<number, Vec2>>;
}

function layoutPosition(layout: Layout, nodeIdText: string | undefined): Vec2 {
  const nodeId = Number(nodeIdText);
  const position = layout.positions[nodeId];
  if (!position) {
    throw new Error(`compileTimeline: layout has no position for node ${nodeIdText}`);
  }
  return position;
}

function compileVirusPositionTrack(events: readonly BattleEvent[], layout: Layout): Keyframe<Vec2>[] {
  const keyframes: Keyframe<Vec2>[] = [];
  for (const event of events) {
    if (event.type !== "virus-entered-node" && event.type !== "virus-departed-node") {
      continue;
    }
    // "entered" keyframes land on the arrival node, "departed" on the node just left — placed
    // back-to-back this naturally produces a hold (two keyframes at the same position, while the
    // virus dwells) followed by a move (interpolating to the next arrival), with no extra logic.
    keyframes.push({ t: event.tick * TICK_SECONDS, value: layoutPosition(layout, event.target) });
  }
  return keyframes;
}

const MARKER_KIND_BY_EVENT: Partial<Record<BattleEventType, TimelineMarkerKind>> = {
  "virus-damaged": "damage",
  "node-destroyed": "destroyed",
  "virus-died": "died",
  "battle-won": "won",
  "battle-timeout": "timeout",
  "status-applied": "status",
  "decoy-absorbed": "status",
};

function describeEvent(event: BattleEvent): string {
  switch (event.type) {
    case "virus-damaged":
      return `${event.actor} deals ${Math.abs(event.delta ?? 0)} damage`;
    case "node-destroyed":
      return `node ${event.target} destroyed`;
    case "virus-died":
      return "virus died";
    case "battle-won":
      return "attacker wins";
    case "battle-timeout":
      return "defender wins (timeout)";
    case "status-applied":
      return `${event.actor} status applied`;
    case "decoy-absorbed":
      return `${event.actor} absorbed by decoy`;
    default:
      return event.type;
  }
}

function compileMarkers(events: readonly BattleEvent[]): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const event of events) {
    const kind = MARKER_KIND_BY_EVENT[event.type];
    if (!kind) {
      continue;
    }
    markers.push({ t: event.tick * TICK_SECONDS, kind, label: describeEvent(event) });
  }
  return markers;
}

export function compileTimeline(log: BattleLog, layout: Layout): Timeline {
  const lastEvent = log.events[log.events.length - 1];
  const virusTrack: EntityTrack = {
    id: "virus",
    position: compileVirusPositionTrack(log.events, layout),
    opacity: [],
  };
  return {
    durationSeconds: (lastEvent?.tick ?? 0) * TICK_SECONDS,
    tracks: [virusTrack],
    markers: compileMarkers(log.events),
  };
}

function sampleKeyframes<T>(keyframes: readonly Keyframe<T>[], t: number, mixFn: (a: T, b: T, tt: number) => T, fallback: T): T {
  if (keyframes.length === 0) {
    return fallback;
  }
  const first = keyframes[0]!;
  if (t <= first.t) {
    return first.value;
  }
  const last = keyframes[keyframes.length - 1]!;
  if (t >= last.t) {
    return last.value;
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const localT = span === 0 ? 1 : (t - a.t) / span;
      const eased = (b.easing ?? linear)(localT);
      return mixFn(a.value, b.value, eased);
    }
  }
  return last.value;
}

/** Pure function of (track, T, fallback) — the scrub-safety the whole Timeline design exists for. */
export function samplePosition(track: EntityTrack, t: number, fallback: Vec2): Vec2 {
  return sampleKeyframes(track.position, t, mixVec2, fallback);
}

export function sampleOpacity(track: EntityTrack, t: number): number {
  return sampleKeyframes(track.opacity, t, mix, 1);
}

export function findTrack(timeline: Timeline, id: string): EntityTrack | undefined {
  return timeline.tracks.find((track) => track.id === id);
}

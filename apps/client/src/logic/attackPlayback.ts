import { compileTimeline, sampleIntegrity, samplePosition, type Timeline, type Vec2 } from "@payload/replay";
import type { BattleLog } from "@payload/sim";
import type { DefendNode } from "../state/defendStore.js";

/**
 * attackPlayback.ts — plays a tested battle back on the Defend map itself rather than in a
 * separate replay canvas.
 *
 * The trick is the Layout handed to compileTimeline: instead of pixel positions inside some
 * canvas, it gets the nodes' own WORLD coordinates. Everything the timeline then reports — the
 * virus's position, where a shot came from — is already in the same space the map draws in, so it
 * renders inside the map's own zoom/pan transform and the player watches the attack happen on the
 * layout they built, at whatever zoom they happen to be looking at it.
 */

/** How long a one-shot effect (a tracer, a hit flash) stays on screen around its own moment.
 * Mirrors packages/replay's own EFFECT_WINDOW_SECONDS so the map and the canvas renderer agree
 * on how long a shot is visible. */
const EFFECT_WINDOW_SECONDS = 0.3;
/** Tail added after the last event so a battle doesn't cut to black the instant it's decided. */
const OUTRO_SECONDS = 1.2;

export interface Shot {
  /** Where the shot came from — an ICE Sentry's world position. */
  readonly from: Vec2;
  /** 0..1 through its visible life; 0 is the instant it fired. */
  readonly progress: number;
  readonly damage: number;
}

export interface NodeFlash {
  readonly nodeId: number;
  readonly progress: number;
  readonly kind: "damage" | "destroyed" | "status";
}

export interface PlaybackFrame {
  readonly virusPosition: Vec2;
  /** 0..1 of starting Integrity. */
  readonly integrity: number;
  readonly virusAlive: boolean;
  /** Shots in flight right now, drawn from their sentry to the virus. */
  readonly shots: readonly Shot[];
  readonly flashes: readonly NodeFlash[];
  /** Damage taken within the last effect window, for the floating "-60" numbers. */
  readonly recentHits: readonly { readonly damage: number; readonly progress: number }[];
  readonly done: boolean;
}

/** Compiles a battle for map playback: node positions are world coordinates, so no conversion
 * happens per frame. */
export function compileForMap(log: BattleLog, nodes: readonly DefendNode[]): Timeline {
  const positions: Record<number, Vec2> = {};
  for (const node of nodes) {
    positions[node.id] = { x: node.x, y: node.y };
  }
  return compileTimeline(log, { positions });
}

export function playbackDurationSeconds(timeline: Timeline): number {
  return timeline.durationSeconds + OUTRO_SECONDS;
}

/**
 * Everything the map needs to draw one frame at time T — a pure function of (timeline, t), the
 * same property packages/replay's own drawFrame is built on, so scrubbing backwards produces
 * exactly the frame it produced on the way forward.
 */
export function frameAt(timeline: Timeline, t: number): PlaybackFrame {
  const track = timeline.tracks.find((candidate) => candidate.id === "virus");
  const fallback = timeline.nodes[0]?.position ?? { x: 0, y: 0 };
  const virusPosition = track ? samplePosition(track, t, fallback) : fallback;
  const died = timeline.markers.find((marker) => marker.kind === "died");

  const shots: Shot[] = [];
  const flashes: NodeFlash[] = [];
  const recentHits: { damage: number; progress: number }[] = [];
  for (const marker of timeline.markers) {
    if (marker.t > t || t - marker.t > EFFECT_WINDOW_SECONDS) {
      continue;
    }
    const progress = (t - marker.t) / EFFECT_WINDOW_SECONDS;
    const node = timeline.nodes.find((candidate) => candidate.id === marker.nodeId);
    if (marker.kind === "damage" && node?.type === "ice-sentry") {
      shots.push({ from: node.position, progress, damage: marker.amount ?? 0 });
    }
    if (marker.kind === "damage" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "damage" });
      // Damage dealt BY a node is damage taken by the virus (see the sim's event vocabulary:
      // "virus-damaged" names its source in `actor`), which is what the floating number reports.
      recentHits.push({ damage: marker.amount ?? 0, progress });
    }
    if (marker.kind === "destroyed" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "destroyed" });
    }
    if (marker.kind === "status" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "status" });
    }
  }

  return {
    virusPosition,
    integrity: sampleIntegrity(timeline, t),
    virusAlive: !died || t < died.t,
    shots,
    flashes,
    recentHits,
    done: t >= playbackDurationSeconds(timeline),
  };
}

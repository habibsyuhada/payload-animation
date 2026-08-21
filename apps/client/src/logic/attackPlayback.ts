import { compileTimeline, entityIdForTrackId, rulesFiringAt, sampleCoreHp, sampleIntegrityFor, samplePosition, trackIdForEntity, type Timeline, type Vec2 } from "@payload/replay";
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
  /** Where it's headed — the specific body it hit (PLAN.md 8.3e), resolved here rather than left
   * for the renderer to look up, so `Defend.tsx` never has to know which of `frame.viruses` a shot
   * belongs to. Falls back to entity 0 for a shot with no `entityId` (a log that never splits). */
  readonly to: Vec2;
  /** 0..1 through its visible life; 0 is the instant it fired. */
  readonly progress: number;
  readonly damage: number;
}

export interface NodeFlash {
  readonly nodeId: number;
  readonly progress: number;
  readonly kind: "damage" | "node-hit" | "destroyed" | "status";
}

export interface NodeHit {
  readonly nodeId: number;
  readonly damage: number;
  readonly progress: number;
}

/** One attacker body at this frame (PLAN.md 8.3e) — `entityId` 0 is always present, matching
 * `Timeline.tracks`'s own guarantee that a "virus" track always exists. */
export interface VirusBodyFrame {
  readonly entityId: number;
  readonly position: Vec2;
  /** 0..1 of starting Integrity. */
  readonly integrity: number;
  readonly alive: boolean;
}

export interface PlaybackFrame {
  /** Entity 0's own position — kept as a scalar alias (PLAN.md 8.3e) so every caller written
   * before `worm-split` existed keeps compiling and behaving identically for a battle that never
   * splits. New code that wants every body should read `viruses` instead. */
  readonly virusPosition: Vec2;
  /** 0..1 of starting Integrity — entity 0's own, same aliasing as `virusPosition`. */
  readonly integrity: number;
  /** 0..1 of the Core's starting HP — the defender's own health bar. */
  readonly coreHp: number;
  /** Entity 0's own — same aliasing as `virusPosition`. */
  readonly virusAlive: boolean;
  /** Every body currently tracked, entity 0 included (PLAN.md 8.3e) — one entry per
   * `Timeline.tracks` track, in ascending entity id order. */
  readonly viruses: readonly VirusBodyFrame[];
  /** Shots in flight right now, drawn from their sentry to whichever body they hit. */
  readonly shots: readonly Shot[];
  readonly flashes: readonly NodeFlash[];
  /** Damage taken within the last effect window, for the floating "-60" numbers — one entry per
   * body (PLAN.md 8.3e: keyed by `entityId`, not a single shared key, so two bodies hit in the
   * same window don't collapse into one floating number at the wrong position). */
  readonly recentHits: readonly { readonly damage: number; readonly progress: number; readonly entityId: number }[];
  /** Damage the virus dealt to nodes in the same window — what the Core losing HP looks like. */
  readonly nodeHits: readonly NodeHit[];
  /** Rule ids (row paths, see gauntletViruses.ts) whose actions had an effect within the same
   * window — what lights the attacker's rule chips as the battle plays (ADR 0006 §6). */
  readonly firedRuleIds: ReadonlySet<string>;
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
  const fallback = timeline.nodes[0]?.position ?? { x: 0, y: 0 };
  const positionForEntity = (entityId: number): Vec2 => {
    const track = timeline.tracks.find((candidate) => candidate.id === trackIdForEntity(entityId));
    return track ? samplePosition(track, t, fallback) : fallback;
  };

  const viruses: VirusBodyFrame[] = timeline.tracks
    .map((track) => entityIdForTrackId(track.id))
    .sort((a, b) => a - b)
    .map((entityId) => {
      const integrity = sampleIntegrityFor(timeline, entityId, t);
      return { entityId, position: positionForEntity(entityId), integrity, alive: integrity > 0 };
    });
  // Entity 0's track always exists (Timeline.tracks' own guarantee), so this is never undefined.
  const entity0 = viruses.find((virus) => virus.entityId === 0)!;

  const shots: Shot[] = [];
  const flashes: NodeFlash[] = [];
  const recentHits: { damage: number; progress: number; entityId: number }[] = [];
  const nodeHits: NodeHit[] = [];
  for (const marker of timeline.markers) {
    if (marker.t > t || t - marker.t > EFFECT_WINDOW_SECONDS) {
      continue;
    }
    const progress = (t - marker.t) / EFFECT_WINDOW_SECONDS;
    const node = timeline.nodes.find((candidate) => candidate.id === marker.nodeId);
    // Absent on a battle that never splits (sheetCanSplit()'s static gate, PLAN.md 8.3b) — falls
    // back to the only body such a battle ever has.
    const entityId = marker.entityId ?? 0;
    if (marker.kind === "damage" && node?.type === "ice-sentry") {
      shots.push({ from: node.position, to: positionForEntity(entityId), progress, damage: marker.amount ?? 0 });
    }
    if (marker.kind === "damage" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "damage" });
      // Damage dealt BY a node is damage taken by the virus (see the sim's event vocabulary:
      // "virus-damaged" names its source in `actor`), which is what the floating number reports.
      recentHits.push({ damage: marker.amount ?? 0, progress, entityId });
    }
    // Damage the virus dealt TO a node: the Core being drained, a Firewall being chewed through.
    if (marker.kind === "node-hit" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "node-hit" });
      nodeHits.push({ nodeId: node.id, damage: marker.amount ?? 0, progress });
    }
    if (marker.kind === "destroyed" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "destroyed" });
    }
    if (marker.kind === "status" && node) {
      flashes.push({ nodeId: node.id, progress, kind: "status" });
    }
  }

  return {
    virusPosition: entity0.position,
    integrity: entity0.integrity,
    coreHp: sampleCoreHp(timeline, t),
    virusAlive: entity0.alive,
    viruses,
    shots,
    flashes: newestPerKey(flashes, (flash) => `${flash.nodeId}:${flash.kind}`),
    // A Core being drained takes damage EVERY tick (20ms apart) while the effect window is 300ms,
    // so without this the same spot carries half a dozen stacked numbers that no one can read.
    // One number per victim, the freshest, reads as a steady beat of damage instead of a pile —
    // keyed per body (PLAN.md 8.3e) so two bodies hit in the same window don't collapse into one.
    recentHits: newestPerKey(recentHits, (hit) => String(hit.entityId)),
    nodeHits: newestPerKey(nodeHits, (hit) => String(hit.nodeId)),
    firedRuleIds: rulesFiringAt(timeline, t, EFFECT_WINDOW_SECONDS),
    done: t >= playbackDurationSeconds(timeline),
  };
}

/** Keeps only the most recent entry per key — "most recent" being the smallest progress, since
 * progress counts up from 0 at the moment the effect fired. */
function newestPerKey<T extends { progress: number }>(entries: readonly T[], keyOf: (entry: T) => string): T[] {
  const newest = new Map<string, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const current = newest.get(key);
    if (!current || entry.progress < current.progress) {
      newest.set(key, entry);
    }
  }
  return [...newest.values()];
}

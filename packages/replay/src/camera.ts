import { findTrack, sampleIntegrityFor, samplePosition, trackIdForEntity, type Timeline, type TimelineMarker, type Vec2 } from "./compile.js";
import { findNode } from "./compile.js";
import { mix } from "./ease.js";

/**
 * camera.ts — PLAN.md R2.3 / GDD §"Cue-based sequencing": intro (overview, 2s) → follow (real-time,
 * tracks the virus) → climax (auto slow-mo around the fatal/winning event) → outro (result hold).
 *
 * This module only produces DATA (a shot: where to look, how zoomed) — it never touches a canvas.
 * The consumer maps playback time -> (battle time T, CameraShot), feeds T into `drawFrame`, and
 * applies the shot itself (translate/scale) around that call. That keeps draw.ts's pure-function
 * contract intact and lets "overview mode" (scrubbing) skip cues entirely: just call
 * `overviewShot(timeline)` and drive `drawFrame` with the scrub T directly — per GDD, cue-based
 * sequencing "bisa dimatikan (mode overview utk scrub)".
 *
 * Durations are computed from the log alone — nothing here is hand-authored per replay — so
 * lengthening one cue (e.g. a longer climax on a longer battle) never perturbs another's math;
 * each cue's battle-time span is derived independently from `timeline`, not by adjusting a
 * previous cue's output.
 */

export type CameraCueKind = "intro" | "follow" | "climax" | "outro";

export interface CameraCue {
  readonly kind: CameraCueKind;
  /** This cue's span in PLAYBACK seconds — wall-clock time of the rendered animation, after slow-mo dilation. */
  readonly playbackStart: number;
  readonly playbackEnd: number;
  /** The BattleLog-time span (Timeline's own T domain, seconds) this cue's playback span maps onto. Intro/outro hold a single instant (start === end). */
  readonly battleStart: number;
  readonly battleEnd: number;
}

export interface CameraShot {
  readonly target: Vec2;
  readonly zoom: number;
}

const INTRO_SECONDS = 2;
const OUTRO_SECONDS = 1.5;
/** Battle-seconds elapsed per playback-second during the climax cue — the auto slow-mo factor. */
const CLIMAX_TIME_SCALE = 0.35;
/** How far back (in battle-seconds) the climax cue reaches before the fatal/winning event, clamped to the battle's own start. */
const CLIMAX_LOOKBACK_SECONDS = 2.5;

const OVERVIEW_ZOOM = 1;
const FOLLOW_ZOOM = 1.4;
const CLIMAX_ZOOM = 2.2;

const TERMINAL_MARKER_KINDS: ReadonlySet<TimelineMarker["kind"]> = new Set(["won", "died", "timeout"]);

function overviewTarget(timeline: Timeline): Vec2 {
  if (timeline.nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  const xs = timeline.nodes.map((node) => node.position.x);
  const ys = timeline.nodes.map((node) => node.position.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * The event the climax cue and the death-moment jump both frame: the battle's own outcome marker,
 * falling back to whatever happened last if the log ended some other way.
 *
 * Scans from the END rather than the start (PLAN.md 8.3e): the battle's real ending is always the
 * LAST event in the log (nothing follows a win/loss), which is also the last thing that could ever
 * compile to a terminal-kind marker — a body that dies and comes back via `set-checkpoint` (PLAN.md
 * 8.3d) produces its own "died" marker along the way, and scanning forward would frame THAT interim
 * death as if it were the outcome.
 */
function terminalMarker(timeline: Timeline): TimelineMarker | undefined {
  for (let i = timeline.markers.length - 1; i >= 0; i -= 1) {
    if (TERMINAL_MARKER_KINDS.has(timeline.markers[i]!.kind)) {
      return timeline.markers[i];
    }
  }
  return timeline.markers[timeline.markers.length - 1];
}

/** Living (Integrity > 0) entity ids at battle-time T, ascending. Empty once every body has died. */
function livingEntityIdsAt(timeline: Timeline, battleT: number): number[] {
  return [...timeline.virusIntegrityByEntity.keys()].filter((entityId) => sampleIntegrityFor(timeline, entityId, battleT) > 0).sort((a, b) => a - b);
}

/** A single body to represent the WHOLE battle when a marker names no specific node (e.g. "won" —
 * whichever body happens to be alive doesn't change who won). Smallest living id, or entity 0 if
 * nobody is (a marker-target lookup still has to return something). */
function representativeEntityId(timeline: Timeline, battleT: number): number {
  return livingEntityIdsAt(timeline, battleT)[0] ?? 0;
}

/**
 * Which body the follow cue should track at T (PLAN.md 8.3e): the living entity closest to
 * `referencePoint` (the terminal marker's own target — where the battle is heading), ties broken
 * by smallest id. Entity 0 can die mid-battle now that `worm-split` exists; blindly following it
 * regardless would leave the camera parked on a corpse while the story moves on elsewhere.
 */
function closestLivingEntityId(timeline: Timeline, battleT: number, referencePoint: Vec2, fallback: Vec2): number {
  const living = livingEntityIdsAt(timeline, battleT);
  if (living.length === 0) {
    return 0; // Nobody's alive — entity 0's track still holds a last-known position worth showing.
  }
  let best = living[0]!;
  let bestDistanceSquared = Infinity;
  for (const entityId of living) {
    const track = findTrack(timeline, trackIdForEntity(entityId));
    const position = track ? samplePosition(track, battleT, fallback) : fallback;
    const dx = position.x - referencePoint.x;
    const dy = position.y - referencePoint.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = entityId;
    }
  }
  return best;
}

function markerTarget(timeline: Timeline, marker: TimelineMarker | undefined, fallback: Vec2): Vec2 {
  if (!marker) {
    return fallback;
  }
  const node = findNode(timeline, marker.nodeId);
  if (node) {
    return node.position;
  }
  const entityId = marker.entityId ?? representativeEntityId(timeline, marker.t);
  const track = findTrack(timeline, trackIdForEntity(entityId));
  return track ? samplePosition(track, marker.t, fallback) : fallback;
}

/**
 * Builds the intro/follow/climax/outro sequence for one Timeline. Pure function of `timeline` —
 * same log always produces the same cues, which is what makes the sequencing safe to recompute
 * on every render rather than caching by hand.
 */
export function computeCameraCues(timeline: Timeline): readonly CameraCue[] {
  const battleEnd = timeline.durationSeconds;
  const marker = terminalMarker(timeline);
  const rawClimaxStart = marker ? marker.t - CLIMAX_LOOKBACK_SECONDS : battleEnd;
  const climaxStart = Math.max(0, Math.min(rawClimaxStart, battleEnd));

  const cues: CameraCue[] = [];
  let playbackCursor = 0;

  cues.push({ kind: "intro", playbackStart: playbackCursor, playbackEnd: playbackCursor + INTRO_SECONDS, battleStart: 0, battleEnd: 0 });
  playbackCursor += INTRO_SECONDS;

  if (climaxStart > 0) {
    cues.push({ kind: "follow", playbackStart: playbackCursor, playbackEnd: playbackCursor + climaxStart, battleStart: 0, battleEnd: climaxStart });
    playbackCursor += climaxStart;
  }

  const climaxBattleSpan = battleEnd - climaxStart;
  if (climaxBattleSpan > 0) {
    const climaxPlaybackSpan = climaxBattleSpan / CLIMAX_TIME_SCALE;
    cues.push({ kind: "climax", playbackStart: playbackCursor, playbackEnd: playbackCursor + climaxPlaybackSpan, battleStart: climaxStart, battleEnd });
    playbackCursor += climaxPlaybackSpan;
  }

  cues.push({ kind: "outro", playbackStart: playbackCursor, playbackEnd: playbackCursor + OUTRO_SECONDS, battleStart: battleEnd, battleEnd });

  return cues;
}

export function playbackDuration(cues: readonly CameraCue[]): number {
  return cues.length === 0 ? 0 : cues[cues.length - 1]!.playbackEnd;
}

function findCue(cues: readonly CameraCue[], playbackT: number): CameraCue {
  const first = cues[0];
  if (!first) {
    throw new Error("camera: cue list is empty");
  }
  if (playbackT <= first.playbackStart) {
    return first;
  }
  for (const cue of cues) {
    if (playbackT >= cue.playbackStart && playbackT <= cue.playbackEnd) {
      return cue;
    }
  }
  return cues[cues.length - 1]!;
}

/** Maps PLAYBACK time to the BattleLog (Timeline) time to feed `drawFrame`/`samplePosition` — this is where slow-mo dilation actually happens: 1 climax playback-second advances battle time by only `CLIMAX_TIME_SCALE` seconds. */
export function battleTimeAt(cues: readonly CameraCue[], playbackT: number): number {
  const cue = findCue(cues, playbackT);
  const span = cue.playbackEnd - cue.playbackStart;
  const localT = span === 0 ? 1 : Math.max(0, Math.min(1, (playbackT - cue.playbackStart) / span));
  return mix(cue.battleStart, cue.battleEnd, localT);
}

/** Fixed fit-all shot used both for the intro/outro holds and as the entire camera when cue-based sequencing is turned off (scrub/overview mode). */
export function overviewShot(timeline: Timeline): CameraShot {
  return { target: overviewTarget(timeline), zoom: OVERVIEW_ZOOM };
}

export function sampleCameraShot(timeline: Timeline, cues: readonly CameraCue[], playbackT: number): CameraShot {
  const cue = findCue(cues, playbackT);
  const fallback = overviewTarget(timeline);

  switch (cue.kind) {
    case "intro":
    case "outro":
      return { target: fallback, zoom: OVERVIEW_ZOOM };
    case "follow": {
      const battleT = battleTimeAt(cues, playbackT);
      const entityId = closestLivingEntityId(timeline, battleT, markerTarget(timeline, terminalMarker(timeline), fallback), fallback);
      const track = findTrack(timeline, trackIdForEntity(entityId));
      const target = track ? samplePosition(track, battleT, fallback) : fallback;
      return { target, zoom: FOLLOW_ZOOM };
    }
    case "climax":
      return { target: markerTarget(timeline, terminalMarker(timeline), fallback), zoom: CLIMAX_ZOOM };
    default: {
      const exhaustive: never = cue.kind;
      throw new Error(`camera: unhandled cue kind ${String(exhaustive)}`);
    }
  }
}

/** GDD: the "Kenapa aku kalah?" shortcut — jump straight to `DEATH_MOMENT_LOOKBACK_SECONDS` of
 * battle-time before the fatal/winning event, in slow-motion, camera zoomed to the related node.
 * Independent of the auto intro/follow/climax/outro sequence above (this is a direct seek, not
 * something the normal playback passes through). Returns undefined for a log with no outcome
 * marker at all (shouldn't happen for a real BattleLog, but this stays a pure function of input). */
export const DEATH_MOMENT_LOOKBACK_SECONDS = 5;
export const DEATH_MOMENT_TIME_SCALE = CLIMAX_TIME_SCALE;

export interface DeathMoment {
  readonly battleStart: number;
  readonly battleEnd: number;
  readonly shot: CameraShot;
}

export function deathMoment(timeline: Timeline): DeathMoment | undefined {
  const marker = terminalMarker(timeline);
  if (!marker) {
    return undefined;
  }
  const fallback = overviewTarget(timeline);
  return {
    battleStart: Math.max(0, marker.t - DEATH_MOMENT_LOOKBACK_SECONDS),
    battleEnd: marker.t,
    shot: { target: markerTarget(timeline, marker, fallback), zoom: CLIMAX_ZOOM },
  };
}

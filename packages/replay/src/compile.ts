import type { BattleEvent, BattleEventType, BattleLog, BlockTier, DefenseNodeType } from "@payload/sim";
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

/** "damage" is always damage taken by the VIRUS (its source node is the marker's nodeId);
 * "node-hit" is the mirror image — damage the virus dealt TO a node, which is what chewing
 * through a Firewall or draining the Core looks like. Keeping them apart matters: a renderer that
 * confused the two would draw the Core's own HP loss as if the virus had been shot. */
export type TimelineMarkerKind = "damage" | "node-hit" | "destroyed" | "died" | "won" | "timeout" | "status" | "respawned";

export interface TimelineMarker {
  readonly t: number;
  readonly kind: TimelineMarkerKind;
  readonly label: string;
  /** The node this marker is about, when it's about one (damage source, node destroyed, status target). */
  readonly nodeId?: number;
  /** How much was dealt or healed, as a positive number — carried explicitly so a renderer can
   * show a combat number without parsing it back out of `label` (where the leading token is the
   * actor's node id, not the amount). */
  readonly amount?: number;
  /** PLAN.md 8.3e: which body this marker is about, mirrored straight from the source `BattleEvent`
   * — absent under the exact same `sheetCanSplit()` gate as everything on `BattleEvent` itself, so
   * a single-body log's markers are byte-identical to before this field existed. */
  readonly entityId?: number;
}

/**
 * A ruleset v2 sheet rule firing at a moment in time (sim's `rule-fired` event, ADR 0006 §6).
 * Kept off `markers` on purpose: every marker kind is about a place on the map, and a rule is
 * about a place in the *sheet* — a renderer that lumped them together would have to filter one
 * out of the other on every frame. `ruleId` is whatever the sim logged: the sheet author's own id
 * when they set one, otherwise the row's path ("2.0").
 */
export interface RuleFiring {
  readonly t: number;
  readonly ruleId: string;
}

/** A defense node's static (never-moving) render data — draw.ts needs this without a separate layout param. */
export interface StaticNode {
  readonly id: number;
  readonly type: DefenseNodeType;
  readonly tier?: BlockTier;
  readonly position: Vec2;
}

export interface StaticEdge {
  readonly from: number;
  readonly to: number;
}

export interface Timeline {
  readonly durationSeconds: number;
  readonly nodes: readonly StaticNode[];
  readonly edges: readonly StaticEdge[];
  /** One track per body — `"virus"` for entity 0 (present even for a log that never splits, same
   * as before this field carried more than one), `"virus:N"` for N >= 1 (PLAN.md 8.3e). */
  readonly tracks: readonly EntityTrack[];
  readonly markers: readonly TimelineMarker[];
  /** Entity 0's health over time, as a 0..1 ratio of its starting Integrity — what a health bar
   * renders from. Compiled from the log's own damage/repair deltas, never recomputed. Kept as its
   * own field (rather than folded into `virusIntegrityByEntity`) so every caller written before
   * multi-entity existed keeps compiling and behaving identically for a log that never splits. */
  readonly virusIntegrity: readonly Keyframe<number>[];
  /** The same track, per body (PLAN.md 8.3e) — `virusIntegrity` above is this map's entry for
   * entity 0. A body born via `worm-split` gets a synthetic keyframe at the tick it's born, so its
   * health bar doesn't read 100% until its first hit (`compileVirusIntegrityTracks`'s doc). */
  readonly virusIntegrityByEntity: ReadonlyMap<number, readonly Keyframe<number>[]>;
  /** The Core's health over time, same 0..1 shape. The battle is won when this hits 0, so it is
   * the other half of the story a health bar tells. */
  readonly coreHp: readonly Keyframe<number>[];
  /** Empty for every v1 log — the engine that produced them has no rules to fire. */
  readonly ruleFirings: readonly RuleFiring[];
}

/** `"virus"` for entity 0 (unchanged from before multi-entity existed), `"virus:N"` for N >= 1
 * (PLAN.md 8.3e) — every existing consumer's `findTrack(timeline, "virus")` keeps finding exactly
 * the track it always did. */
export function trackIdForEntity(entityId: number): string {
  return entityId === 0 ? "virus" : `virus:${entityId}`;
}

/** Inverse of `trackIdForEntity` — every `Timeline.tracks` entry's `id` round-trips through this. */
export function entityIdForTrackId(trackId: string): number {
  return trackId === "virus" ? 0 : Number(trackId.slice("virus:".length));
}

/**
 * The Integrity every virus starts a battle with (engine.ts's `virusIntegrity: 1000`). Mirrored
 * rather than imported for the same reason TICK_SECONDS is: packages/replay may read sim's types
 * but not its runtime values, so it can never become a second interpreter of gameplay rules. The
 * log's deltas are absolute damage numbers, so turning them into a 0..1 bar needs the scale they
 * were measured against.
 */
const VIRUS_START_INTEGRITY = 1000;

/**
 * Health-over-time, per body, replayed from the events rather than simulated: every
 * `virus-damaged`/`virus-repaired` delta is applied in order, giving one keyframe per change.
 * `virus-died` (either role, PLAN.md 8.3d — the battle-ending one or a body's own) zeroes it
 * outright; `virus-respawned` and `virus-split` set it directly to their `delta`, which is already
 * the resulting absolute Integrity (not an amount to add — see those two events' own docs).
 * Damage lands on the tick it happened — no easing into it — so a hit reads as a hit rather than a
 * slow drain.
 *
 * Grouped by `event.entityId ?? 0`: for a log that never splits every event has no `entityId`, so
 * this collapses to exactly the single "entity 0" track the pre-8.3e version compiled — same
 * keyframes, same order, same values.
 */
function compileVirusIntegrityTracks(events: readonly BattleEvent[]): Map<number, Keyframe<number>[]> {
  const byEntity = new Map<number, Keyframe<number>[]>();
  const integrityByEntity = new Map<number, number>();
  const trackFor = (entityId: number): Keyframe<number>[] => {
    let keyframes = byEntity.get(entityId);
    if (!keyframes) {
      keyframes = [{ t: 0, value: 1 }];
      byEntity.set(entityId, keyframes);
      integrityByEntity.set(entityId, VIRUS_START_INTEGRITY);
    }
    return keyframes;
  };
  trackFor(0); // Entity 0 always gets a track, even an empty-of-damage one — matches pre-8.3e shape.

  for (const event of events) {
    if (event.type === "virus-split") {
      // Two effects at once: the SPLITTING body's own Integrity drops to `delta` (a normal
      // keyframe on its existing track), and the NEW body is born with that same value — its track
      // starts at the split tick, not a fictitious t=0 full-health entry it never actually had.
      const parentId = event.entityId ?? 0;
      const parentIntegrity = event.delta ?? 0;
      trackFor(parentId).push({ t: event.tick * TICK_SECONDS, value: parentIntegrity / VIRUS_START_INTEGRITY });
      integrityByEntity.set(parentId, parentIntegrity);
      const childId = Number(event.target);
      byEntity.set(childId, [{ t: event.tick * TICK_SECONDS, value: parentIntegrity / VIRUS_START_INTEGRITY }]);
      integrityByEntity.set(childId, parentIntegrity);
      continue;
    }
    if (event.type !== "virus-damaged" && event.type !== "virus-repaired" && event.type !== "virus-died" && event.type !== "virus-respawned") {
      continue;
    }
    const entityId = event.entityId ?? 0;
    const keyframes = trackFor(entityId);
    let integrity = integrityByEntity.get(entityId)!;
    if (event.type === "virus-damaged" || event.type === "virus-repaired") {
      integrity = Math.max(0, Math.min(VIRUS_START_INTEGRITY, integrity + (event.delta ?? 0)));
    } else if (event.type === "virus-died") {
      integrity = 0;
    } else {
      // virus-respawned: delta is already the resulting absolute Integrity.
      integrity = event.delta ?? 0;
    }
    integrityByEntity.set(entityId, integrity);
    keyframes.push({ t: event.tick * TICK_SECONDS, value: integrity / VIRUS_START_INTEGRITY });
  }
  return byEntity;
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

/**
 * Position-over-time, per body (PLAN.md 8.3e). Grouped by `event.entityId ?? 0`, so a log that
 * never splits collapses to the single "entity 0" track the pre-8.3e version compiled — same
 * keyframes, same order, same values. Without this grouping, mixing every body's arrivals into one
 * list would read as one virus teleporting between locations rather than several bodies each
 * moving on their own.
 *
 * A body born via `worm-split` gets one synthetic keyframe at the split tick, sampled from its
 * PARENT's own track at that instant — it's born exactly where its parent was, not wherever the
 * caller's fallback position happens to be until its own first move.
 */
function compileVirusPositionTracks(events: readonly BattleEvent[], layout: Layout): Map<number, Keyframe<Vec2>[]> {
  const byEntity = new Map<number, Keyframe<Vec2>[]>();
  const trackFor = (entityId: number): Keyframe<Vec2>[] => {
    let keyframes = byEntity.get(entityId);
    if (!keyframes) {
      keyframes = [];
      byEntity.set(entityId, keyframes);
    }
    return keyframes;
  };
  trackFor(0); // Entity 0 always gets a track, even an empty one — matches pre-8.3e shape.

  for (const event of events) {
    if (event.type === "virus-entered-node" || event.type === "virus-departed-node") {
      // "entered" keyframes land on the arrival node, "departed" on the node just left — placed
      // back-to-back this naturally produces a hold (two keyframes at the same position, while the
      // body dwells) followed by a move (interpolating to the next arrival), with no extra logic.
      trackFor(event.entityId ?? 0).push({ t: event.tick * TICK_SECONDS, value: layoutPosition(layout, event.target) });
    } else if (event.type === "virus-split") {
      const parentFrames = byEntity.get(event.entityId ?? 0);
      if (!parentFrames || parentFrames.length === 0) {
        continue; // Shouldn't happen — the parent has existed since before tick 0 — but stay pure rather than throw.
      }
      const splitT = event.tick * TICK_SECONDS;
      const birthPosition = sampleKeyframes(parentFrames, splitT, mixVec2, parentFrames[parentFrames.length - 1]!.value);
      trackFor(Number(event.target)).push({ t: splitT, value: birthPosition });
    }
  }
  return byEntity;
}

const MARKER_KIND_BY_EVENT: Partial<Record<BattleEventType, TimelineMarkerKind>> = {
  "virus-damaged": "damage",
  "node-damaged": "node-hit",
  "node-destroyed": "destroyed",
  "virus-died": "died",
  "battle-won": "won",
  "battle-timeout": "timeout",
  "status-applied": "status",
  "decoy-absorbed": "status",
  // PLAN.md 8.3d — its own kind, not "status": draw.ts needs to tell "came back" apart from every
  // other status change to know a body's most recent death has been undone.
  "virus-respawned": "respawned",
  // "virus-split" is deliberately UNMAPPED: its `target`/`actor` are entity ids, not node ids, and
  // `resolveMarkerNodeId` below would happily (and wrongly) resolve one if a defense node happened
  // to share that same small integer. No marker for it yet is more honest than a wrong one.
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
    case "virus-respawned":
      return `virus respawns at node ${event.target}`;
    default:
      return event.type;
  }
}

/**
 * "virus-damaged" is about its damage SOURCE (event.actor); "node-damaged"/"node-destroyed" and
 * decoy/status events are about their TARGET (for damage) or actor (for status/decoy) — whichever
 * field names an actual defense node id. Neither field is a node id for "virus"/block-name actors
 * like "self-repair" — Number(...) on those is NaN, so the id simply comes back undefined.
 */
function resolveMarkerNodeId(event: BattleEvent, nodeIds: ReadonlySet<number>): number | undefined {
  const candidates = event.type === "virus-damaged" ? [event.actor] : [event.target, event.actor];
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && nodeIds.has(id)) {
      return id;
    }
  }
  return undefined;
}

function compileMarkers(events: readonly BattleEvent[], nodeIds: ReadonlySet<number>): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const event of events) {
    const kind = MARKER_KIND_BY_EVENT[event.type];
    if (!kind) {
      continue;
    }
    const nodeId = resolveMarkerNodeId(event, nodeIds);
    const amount = event.delta === undefined ? undefined : Math.abs(event.delta);
    markers.push({
      t: event.tick * TICK_SECONDS,
      kind,
      label: describeEvent(event),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(event.entityId !== undefined ? { entityId: event.entityId } : {}),
    });
  }
  return markers;
}

/** The Core's health, replayed from the `node-damaged` events aimed at it. Unlike the virus's
 * Integrity there's no constant to mirror: the log carries the Core's starting HP in its own
 * input, so the ratio is exact for any account tier. */
function compileCoreHpTrack(log: BattleLog): Keyframe<number>[] {
  const coreId = String(log.input.defense.coreNodeId);
  const startingHp = log.input.defense.coreHp;
  const keyframes: Keyframe<number>[] = [{ t: 0, value: 1 }];
  if (startingHp <= 0) {
    return keyframes;
  }
  let hp = startingHp;
  for (const event of log.events) {
    if (event.type !== "node-damaged" || event.target !== coreId) {
      continue;
    }
    hp = Math.max(0, Math.min(startingHp, hp + (event.delta ?? 0)));
    keyframes.push({ t: event.tick * TICK_SECONDS, value: hp / startingHp });
  }
  return keyframes;
}

function compileRuleFirings(events: readonly BattleEvent[]): RuleFiring[] {
  return events.filter((event) => event.type === "rule-fired").map((event) => ({ t: event.tick * TICK_SECONDS, ruleId: event.actor }));
}

export function compileTimeline(log: BattleLog, layout: Layout): Timeline {
  const lastEvent = log.events[log.events.length - 1];
  const staticNodes: StaticNode[] = log.input.defense.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    ...(node.tier !== undefined ? { tier: node.tier } : {}),
    position: layoutPosition(layout, String(node.id)),
  }));

  const positionsByEntity = compileVirusPositionTracks(log.events, layout);
  const tracks: EntityTrack[] = [...positionsByEntity.entries()].sort(([a], [b]) => a - b).map(([entityId, position]) => ({ id: trackIdForEntity(entityId), position, opacity: [] }));

  const virusIntegrityByEntity = compileVirusIntegrityTracks(log.events);

  return {
    durationSeconds: (lastEvent?.tick ?? 0) * TICK_SECONDS,
    nodes: staticNodes,
    edges: log.input.defense.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    tracks,
    markers: compileMarkers(log.events, new Set(staticNodes.map((node) => node.id))),
    virusIntegrity: virusIntegrityByEntity.get(0) ?? [{ t: 0, value: 1 }],
    virusIntegrityByEntity,
    coreHp: compileCoreHpTrack(log),
    ruleFirings: compileRuleFirings(log.events),
  };
}

/**
 * Which rules were firing at T, within `windowSeconds` of their moment. A window rather than an
 * exact match because a rule fires for one 50ms tick and nobody can see a 50ms flash — the same
 * reason the map's hit effects have one.
 */
export function rulesFiringAt(timeline: Timeline, t: number, windowSeconds: number): Set<string> {
  const firing = new Set<string>();
  for (const rule of timeline.ruleFirings) {
    if (rule.t <= t && t - rule.t <= windowSeconds) {
      firing.add(rule.ruleId);
    }
  }
  return firing;
}

/** Health at T as a 0..1 ratio — a step function, not an interpolation: a hit is instant, and
 * sampling between two hits must report the health it actually had then. */
function sampleStep(keyframes: readonly Keyframe<number>[], t: number): number {
  let value = keyframes[0]?.value ?? 1;
  for (const keyframe of keyframes) {
    if (keyframe.t > t) {
      break;
    }
    value = keyframe.value;
  }
  return value;
}

/** The virus's health at T, as a 0..1 ratio of what it started with. */
export function sampleIntegrity(timeline: Timeline, t: number): number {
  return sampleStep(timeline.virusIntegrity, t);
}

/** A specific body's health at T (PLAN.md 8.3e) — 1 (full) for an entity id the log never
 * mentions, e.g. one that hasn't been born yet at this T. */
export function sampleIntegrityFor(timeline: Timeline, entityId: number, t: number): number {
  const track = timeline.virusIntegrityByEntity.get(entityId);
  return track ? sampleStep(track, t) : 1;
}

/** The Core's health at T, as a 0..1 ratio of what it started with. */
export function sampleCoreHp(timeline: Timeline, t: number): number {
  return sampleStep(timeline.coreHp, t);
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

export function findNode(timeline: Timeline, id: number | undefined): StaticNode | undefined {
  return id === undefined ? undefined : timeline.nodes.find((node) => node.id === id);
}
